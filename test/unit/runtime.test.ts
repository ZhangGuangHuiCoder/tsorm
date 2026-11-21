// 不依赖数据库的运行时单元测试：sql 片段、标识符引用和迁移提供者。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "bun:test";
import { DbNull, JsonNull, OrmError, sql } from "../../src/index.js";
import { quoteIdentifier } from "../../src/shared/index.js";
import { quoteMysqlIdentifier } from "../../src/adapters/mysql/driver.js";
import { columnChanges, structuralIndexKey } from "../../src/migrations/provider.js";
import { providerFor } from "../../src/adapters/registry.js";

const validation = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe("VALIDATION");
    return;
  }
  throw new Error("expected a VALIDATION error");
};

describe("sql fragments", () => {
  // 按顺序收集参数，并展开嵌套片段
  test("collects values in order and flattens nested fragments", () => {
    const inner = sql`b = ${2} AND c = ${3}`;
    const query = sql`SELECT * FROM t WHERE a = ${1} AND ${inner} AND d = ${4}`;
    expect(query.strings).toEqual(["SELECT * FROM t WHERE a = ", " AND b = ", " AND c = ", " AND d = ", ""]);
    expect(query.values).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(query)).toBeTrue();
  });

  // sql 只能作为标签模板使用
  test("must be used as a tagged template", () => {
    validation(() => {
      return (sql as any)("SELECT 1");
    });
  });
});

describe("identifiers", () => {
  // ANSI 与 MySQL 标识符引用会转义内部引号
  test("ANSI and MySQL quoting escape embedded quotes", () => {
    expect(quoteIdentifier("User")).toBe('"User"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(quoteMysqlIdentifier("User")).toBe("`User`");
    expect(quoteMysqlIdentifier("a`b")).toBe("`a``b`");
  });
});

describe("json null markers", () => {
  // DbNull 与 JsonNull 是互不相同的冻结哨兵对象
  test("DbNull and JsonNull are distinct frozen sentinels", () => {
    expect(DbNull).not.toBe(JsonNull);
    expect(Object.isFrozen(DbNull)).toBeTrue();
    expect(Object.isFrozen(JsonNull)).toBeTrue();
  });
});

describe("migration providers", () => {
  // providerFor 根据 URL 选择迁移提供者
  test("providerFor picks the provider from the url", async () => {
    expect((await providerFor("file:./dev.db")).id).toBe("sqlite");
    expect((await providerFor("postgresql://u:p@h/db")).id).toBe("postgresql");
    expect((await providerFor("mysql://u:p@h/db")).id).toBe("mysql");
    await expect(providerFor("mongodb://h/db")).rejects.toThrow();
  });

  // 各提供者的参数占位符和标识符引用
  test("placeholders and quoting per provider", async () => {
    expect((await providerFor("postgresql://h/db")).param(3)).toBe("$3");
    expect((await providerFor("mysql://h/db")).param(3)).toBe("?");
    expect((await providerFor("mysql://h/db")).quote("t")).toBe("`t`");
    expect((await providerFor("file:x.db")).quote("t")).toBe('"t"');
  });

  const column = (over: Record<string, unknown> = {}) => {
    return {
      name: "c",
      type: "INTEGER",
      nullable: false,
      default: null,
      auto: false,
      definition: "c INTEGER",
      ...over,
    } as any;
  };

  // columnChanges 报告每个不同的列属性
  test("columnChanges reports each attribute that differs", () => {
    expect(columnChanges(column(), column(), true)).toEqual([]);
    expect(columnChanges(column(), column({ type: "integer" }), true)).toEqual([]);
    expect(columnChanges(column(), column({ type: "TEXT", nullable: true }), true)).toEqual(["type", "nullability"]);
    expect(columnChanges(column(), column({ default: "1", auto: true }), true)).toEqual(["default", "autoincrement"]);
  });

  // 只有要求时 columnChanges 才比较列定义文本
  test("columnChanges falls back to the definition only when asked", () => {
    const other = column({ definition: "c INTEGER CHECK (c > 0)" });
    expect(columnChanges(column(), other, true)).toEqual(["definition"]);
    expect(columnChanges(column(), other, false)).toEqual([]);
  });

  // structuralIndexKey 区分索引名、唯一性和列顺序
  test("structuralIndexKey distinguishes name, uniqueness and column order", () => {
    const index = (over: Record<string, unknown> = {}) => {
      return { name: "i", unique: false, columns: ["a", "b"], definition: "", ...over } as any;
    };
    expect(structuralIndexKey(index())).toBe(structuralIndexKey(index({ definition: "whatever" })));
    expect(structuralIndexKey(index())).not.toBe(structuralIndexKey(index({ unique: true })));
    expect(structuralIndexKey(index())).not.toBe(structuralIndexKey(index({ columns: ["b", "a"] })));
  });
});

// ─── 公开 API 表面守卫 ─────────────────────────────────────────────────────
// 文档表格必须与源码实际导出一致；schema 中标注 @internal 的 helper 不属于文档承诺范围。
const readSource = (relative: string): string => {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
};
const declaredSymbols = (file: string): Set<string> => {
  const text = readSource(file);
  const names = new Set<string>();
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()!
        .trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) {
        names.add(name);
      }
    }
  }
  for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:type|interface|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  return names;
};
const internalSymbols = (file: string): Set<string> => {
  const names = new Set<string>();
  const text = readSource(file);
  // 单个 JSDoc 块内匹配：禁止跨越第一个 */，否则会把文件头注释里的 @internal 误算到后面的导出上。
  const pattern = /\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*export\s+(?:type\s+|interface\s+|class\s+|function\s+|const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1].includes("@internal")) {
      names.add(match[2]);
    }
  }
  return names;
};
const documentedSymbols = (file: string, section: string): Set<string> => {
  const text = readSource(file);
  const marker = `<!-- exports:${section} -->`;
  const start = text.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing export markers for ${section} in ${file}`);
  }
  const contentStart = start + marker.length;
  // 每个 section 以「下一个 exports 标记」结束（含末尾的 exports:end）。
  const nextMarker = text.indexOf("<!-- exports:", contentStart);
  const end = nextMarker < 0 ? text.length : nextMarker;
  const names = new Set<string>();
  for (const line of text.slice(contentStart, end).split("\n")) {
    const match = /^\|\s*`((?:type\s+)?[A-Za-z_$][\w$]*)`\s*\|/.exec(line.trim());
    if (match) {
      names.add(match[1].replace(/^type\s+/, ""));
    }
  }
  return names;
};
const publicSymbols = (file: string, internalFiles: readonly string[] = [file]): string[] => {
  const declared = declaredSymbols(file);
  for (const internalFile of internalFiles) {
    for (const name of internalSymbols(internalFile)) {
      declared.delete(name);
    }
  }
  return [...declared].sort();
};

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
const sourceFiles = readdirSync(sourceRoot, { recursive: true })
  .map(String)
  .filter((file) => {
    return file.endsWith(".ts");
  })
  .map((file) => {
    return resolve(sourceRoot, file);
  });
const sourceSet = new Set(sourceFiles);
const runtimeGraph = (): Map<string, string[]> => {
  const graph = new Map<string, string[]>();
  for (const file of sourceFiles) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const dependencies = new Set<string>();
    for (const statement of source.statements) {
      let specifier: string | undefined;
      let runtime = false;
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        runtime =
          !clause ||
          (!clause.isTypeOnly &&
            (!!clause.name ||
              !clause.namedBindings ||
              ts.isNamespaceImport(clause.namedBindings) ||
              !clause.namedBindings.elements.length ||
              clause.namedBindings.elements.some((element) => {
                return !element.isTypeOnly;
              })));
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifier = statement.moduleSpecifier.text;
        runtime =
          !statement.isTypeOnly &&
          (!statement.exportClause ||
            ts.isNamespaceExport(statement.exportClause) ||
            !statement.exportClause.elements.length ||
            statement.exportClause.elements.some((element) => {
              return !element.isTypeOnly;
            }));
      }
      if (!runtime || !specifier?.startsWith(".")) {
        continue;
      }
      const dependency = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (sourceSet.has(dependency)) {
        dependencies.add(dependency);
      }
    }
    graph.set(file, [...dependencies]);
  }
  return graph;
};

describe("source dependency boundaries", () => {
  test("internal implementations bypass the schema entrypoint", () => {
    const graph = runtimeGraph();
    const schemaEntry = resolve(sourceRoot, "schema/index.ts");
    const offenders = [...graph]
      .filter(([file, dependencies]) => {
        return file !== schemaEntry && dependencies.includes(schemaEntry);
      })
      .map(([file]) => {
        return relative(sourceRoot, file);
      });
    expect(offenders).toEqual([]);
  });

  test("the static runtime dependency graph is acyclic", () => {
    const graph = runtimeGraph();
    const complete = new Set<string>();
    const active = new Set<string>();
    const stack: string[] = [];
    const cycles: string[][] = [];
    const visit = (file: string) => {
      if (complete.has(file)) {
        return;
      }
      if (active.has(file)) {
        const start = stack.indexOf(file);
        cycles.push([...stack.slice(start), file].map((item) => relative(sourceRoot, item)));
        return;
      }
      active.add(file);
      stack.push(file);
      for (const dependency of graph.get(file) ?? []) {
        visit(dependency);
      }
      stack.pop();
      active.delete(file);
      complete.add(file);
    };
    for (const file of graph.keys()) {
      visit(file);
    }
    expect(cycles).toEqual([]);
  });
});

describe("dialect-agnostic standard layers", () => {
  // core / migrations / query / schema / shared 只描述「标准能力」，
  // 不得内置任何数据库方言知识：既不出现方言名或方言专属语法，也不直接依赖具体方言与驱动。
  const standardDirs = ["core", "migrations", "query", "schema", "shared"] as const;
  const standardFiles = (): string[] => {
    const files: string[] = [];
    for (const dir of standardDirs) {
      const root = resolve(sourceRoot, dir);
      for (const entry of readdirSync(root, { recursive: true })) {
        const file = resolve(root, String(entry));
        if (file.endsWith(".ts")) {
          files.push(file);
        }
      }
    }
    return files;
  };
  const moduleSpecifiers = (file: string): string[] => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const specifiers: string[] = [];
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
    return specifiers;
  };
  // 方言产品名（含 postgres 前缀写法 postgres / postgresql）。
  const dialectName = /\b(sqlite|mysql|mariadb|postgres)\w*/gi;
  // 只属于某个方言的 SQL 语法。
  const dialectSyntax = /\b(AUTO_INCREMENT|BIGSERIAL|ILIKE|PRAGMA|LAST_INSERT_ID|ON\s+DUPLICATE\s+KEY|ENGINE\s*=\s*\w+|WITHOUT\s+TIME\s+ZONE)\b/gi;
  const driverPackages = ["pg", "mariadb", "mysql2", "better-sqlite3", "node:sqlite"];

  test("the standard layers name no database product", () => {
    const offenders: string[] = [];
    for (const file of standardFiles()) {
      for (const match of readFileSync(file, "utf8").matchAll(dialectName)) {
        offenders.push(`${relative(sourceRoot, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the standard layers contain no dialect-only syntax", () => {
    const offenders: string[] = [];
    for (const file of standardFiles()) {
      for (const match of readFileSync(file, "utf8").matchAll(dialectSyntax)) {
        offenders.push(`${relative(sourceRoot, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the standard layers depend on no dialect or driver", () => {
    const offenders: string[] = [];
    for (const file of standardFiles()) {
      const owner = relative(sourceRoot, file);
      for (const specifier of moduleSpecifiers(file)) {
        if (driverPackages.includes(specifier)) {
          offenders.push(`${owner} -> ${specifier}`);
          continue;
        }
        const match = /(^|\/)adapters\/(.+)\.js$/.exec(specifier);
        if (!match) {
          continue;
        }
        // 只有 migrations 这层命令行边缘允许按 URL 分派，且只能经过 registry。
        const allowed = match[2] === "registry" && owner.startsWith("migrations" + "/");
        if (!allowed) {
          offenders.push(`${owner} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("documented entrypoints match real exports", () => {
  const entries = [
    ["root", "../../src/index.ts", ["../../src/index.ts"]],
    ["schema", "../../src/schema/index.ts", ["../../src/schema/index.ts", "../../src/schema/model.ts"]],
    ["migrations", "../../src/migrations/index.ts", ["../../src/migrations/index.ts"]],
    ["sqlite", "../../src/adapters/sqlite/index.ts", ["../../src/adapters/sqlite/index.ts"]],
    ["mysql", "../../src/adapters/mysql/index.ts", ["../../src/adapters/mysql/index.ts"]],
    ["postgres", "../../src/adapters/postgres/index.ts", ["../../src/adapters/postgres/index.ts"]],
  ] as const;
  for (const [section, source, internalFiles] of entries) {
    test(`en ${section}: docs symbols == public source exports`, () => {
      expect([...documentedSymbols("../../docs/reference/client-api.md", section)].sort()).toEqual(publicSymbols(source, internalFiles));
    });
    test(`zh ${section}: docs symbols == public source exports`, () => {
      expect([...documentedSymbols("../../docs/zh/reference/client-api.md", section)].sort()).toEqual(publicSymbols(source, internalFiles));
    });
  }

  test("core root symbols stay documented", () => {
    const en = documentedSymbols("../../docs/reference/client-api.md", "root");
    for (const name of ["internalCreateClient", "ClientOptions", "Client", "Schema"]) {
      expect(en.has(name)).toBe(true);
    }
  });

  test("adapter connection interfaces and postgres literal are not exported", () => {
    const postgres = declaredSymbols("../../src/adapters/postgres/index.ts");
    const mysql = declaredSymbols("../../src/adapters/mysql/index.ts");
    expect(postgres.has("literal")).toBe(false);
    expect(postgres.has("postgresLiteral")).toBe(false);
    expect(postgres.has("PostgresConnection")).toBe(false);
    expect(mysql.has("MySQLConnection")).toBe(false);
  });
});
