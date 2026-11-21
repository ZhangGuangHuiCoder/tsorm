import type { Connection, MigrationProvider } from "./provider.js";
import { internalHistoryTable } from "../schema/model.js";

// ─── Database introspection ────────────────────────────────────────────────
/**
 * Migrate 比较时所用的数据库物理结构。
 * Physical structure of one database, as Migrate compares it.
 */
export interface DbColumn {
  name: string;
  /** Normalized type text as the database reports it. */
  type: string;
  nullable: boolean;
  default: string | null;
  auto: boolean;
  /** Full column definition used when rendering DDL. */
  definition: string;
  /** Column comment, when the database stores one. */
  comment?: string;
}
export interface DbConstraint {
  name: string;
  columns: string[];
  /** Canonical definition used both for comparison and rendering. */
  definition: string;
}
export interface DbIndex extends DbConstraint {
  unique: boolean;
}
export interface DbForeignKey extends DbConstraint {
  table: string;
  references: string[];
}
export interface DbCheck {
  name: string;
  column?: string;
  expression: string;
}
export interface DbTable {
  name: string;
  columns: DbColumn[];
  primaryKey?: DbConstraint;
  /** Unique constraints that are not standalone indexes. */
  uniques: DbConstraint[];
  indexes: DbIndex[];
  checks: DbCheck[];
  foreignKeys: DbForeignKey[];
  /** Full CREATE TABLE text as the provider captures it. */
  definition: string;
  /** Table comment, when the database stores one. */
  comment?: string;
}
export interface DbModel {
  provider: MigrationProvider;
  tables: Record<string, DbTable>;
}

/**
 * 此连接的迁移记录所在的历史表。
 * The history table this connection's migrations are recorded in.
 */
export const historyTable = (conn: Connection): string => {
  return conn.datasource.historyTable ?? internalHistoryTable;
};

export function introspect(conn: Connection): Promise<DbModel> {
  return conn.provider.introspect(conn);
}

/**
 * 在顶层分隔符处拆分 SQL，同时正确处理引号与括号。
 * Splits SQL at top-level separators, honouring quotes and parentheses.
 */
export function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          i++;
        } else {
          quote = null;
        }
      } else if (quote === "]" && ch === "]") {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "[") {
      quote = "]";
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * 返回从 `open` 开始的平衡括号文本，包含括号。
 * Returns the balanced parenthesized text starting at `open`, including the parentheses.
 */
export function balanced(text: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = text[i + 1] === quote ? (i++, quote) : null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "[") {
      quote = "]";
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")" && --depth === 0) {
      return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

export const unquote = (name: string) => {
  const first = name[0];
  if (first === '"' || first === "`") {
    return name.slice(1, -1).replaceAll(first + first, first);
  }
  if (first === "[") {
    return name.slice(1, -1);
  }
  return name;
};
export const leadingIdentifier = (text: string) => {
  return /^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[^\s(]+)/.exec(text)![1];
};
/**
 * 规范化 SQL 空白，不更改带引号的字面量或标识符。
 * Normalize SQL whitespace without changing quoted literals or identifiers.
 */
export function squash(text: string): string {
  let result = "";
  let quote: string | undefined;
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      result += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) {
          result += text[++i];
        } else {
          quote = undefined;
        }
      }
    } else if (/\s/.test(ch)) {
      space = true;
    } else {
      if (space && result) {
        result += " ";
      }
      space = false;
      result += ch;
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
      } else if (ch === "[") {
        quote = "]";
      }
    }
  }
  return result;
}

/**
 * 提取单列定义或表约束中深度为 0 的 CHECK 表达式。
 * CHECK expressions inside one column definition or table constraint, at depth 0.
 */
export function checksIn(item: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (quote) {
      if (ch === quote) {
        quote = item[i + 1] === quote ? (i++, quote) : null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "[") {
      quote = "]";
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (depth === 0 && /^check\s*\(/i.test(item.slice(i)) && !/\w/.test(item[i - 1] ?? "")) {
      const open = item.indexOf("(", i);
      const expression = balanced(item, open);
      found.push(squash(expression));
      i = open + expression.length - 1;
    }
  }
  return found;
}

/**
 * 当数据库包含除迁移历史表和忽略表之外的任何表时返回 true。
 * True when the database holds any table besides the migration history and the ignored ones.
 */
export async function hasTables(conn: Connection): Promise<boolean> {
  return Object.keys((await introspect(conn)).tables).length > 0;
}

// ─── Schema diff ───────────────────────────────────────────────────────────

/** A step whose safety depends on the data currently stored. */
type RiskCheck =
  | { kind: "dropTable"; table: string }
  | { kind: "dropColumn"; table: string; column: string }
  | { kind: "alterType"; table: string; column: string; from: string; to: string }
  | { kind: "addRequired"; table: string; column: string }
  | { kind: "makeRequired"; table: string; column: string }
  | { kind: "addUnique"; table: string; columns: string[] };

export interface SchemaDiff {
  empty: boolean;
  /** Migration script; an empty string when nothing changed. */
  sql: string;
  /** Human-readable summary of the changes. */
  summary: string;
  risks: RiskCheck[];
}

interface ColumnChange {
  from: DbColumn;
  to: DbColumn;
  changes: string[];
}
export interface TableChange {
  name: string;
  from: DbTable;
  to: DbTable;
  addedColumns: DbColumn[];
  droppedColumns: DbColumn[];
  alteredColumns: ColumnChange[];
  primaryKey: boolean;
  /** True when the table comment changed. */
  comment: boolean;
  addedUniques: DbConstraint[];
  droppedUniques: DbConstraint[];
  addedIndexes: DbIndex[];
  droppedIndexes: DbIndex[];
  addedChecks: DbCheck[];
  droppedChecks: DbCheck[];
  addedForeignKeys: DbForeignKey[];
  droppedForeignKeys: DbForeignKey[];
}

const uniqueKey = (u: DbConstraint) => {
  return u.columns.join("\0");
};
const checkKey = (c: DbCheck) => {
  return (c.column ?? "") + "\0" + c.expression;
};
const fkKey = (f: DbForeignKey) => {
  return [f.columns.join(","), f.table, f.references.join(","), f.definition.replace(/^CONSTRAINT `(?:[^`]|``)*` /, "")].join("\0");
};

function compare<T>(from: T[], to: T[], key: (item: T) => string) {
  const before = new Set(from.map(key));
  const after = new Set(to.map(key));
  return {
    added: to.filter((item) => {
      return !before.has(key(item));
    }),
    dropped: from.filter((item) => {
      return !after.has(key(item));
    }),
  };
}

function tableChange(provider: MigrationProvider, from: DbTable, to: DbTable): TableChange | undefined {
  const columns = compare(from.columns, to.columns, (c) => {
    return c.name;
  });
  const alteredColumns: ColumnChange[] = [];
  for (const b of to.columns) {
    const a = from.columns.find((c) => {
      return c.name === b.name;
    });
    if (!a) {
      continue;
    }
    const changes = provider.columnChanges(a, b);
    if (changes.length) {
      alteredColumns.push({ from: a, to: b, changes });
    }
  }
  const uniques = compare(from.uniques, to.uniques, uniqueKey);
  const indexes = compare(from.indexes, to.indexes, (i) => {
    return provider.indexKey(i);
  });
  const checks = compare(from.checks, to.checks, checkKey);
  const fks = compare(from.foreignKeys, to.foreignKeys, fkKey);
  const change: TableChange = {
    name: to.name,
    from,
    to,
    addedColumns: columns.added,
    droppedColumns: columns.dropped,
    alteredColumns,
    primaryKey: (from.primaryKey?.columns.join("\0") ?? "") !== (to.primaryKey?.columns.join("\0") ?? ""),
    comment: (from.comment ?? "") !== (to.comment ?? ""),
    addedUniques: uniques.added,
    droppedUniques: uniques.dropped,
    addedIndexes: indexes.added,
    droppedIndexes: indexes.dropped,
    addedChecks: checks.added,
    droppedChecks: checks.dropped,
    addedForeignKeys: fks.added,
    droppedForeignKeys: fks.dropped,
  };
  const changed =
    change.primaryKey ||
    change.comment ||
    alteredColumns.length ||
    [columns, uniques, indexes, checks, fks].some((c) => {
      return c.added.length || c.dropped.length;
    });
  return changed ? change : undefined;
}

export function diffModels(from: DbModel, to: DbModel): SchemaDiff {
  const provider = to.provider;
  const created = Object.values(to.tables).filter((t) => {
    return !from.tables[t.name];
  });
  const dropped = Object.values(from.tables).filter((t) => {
    return !to.tables[t.name];
  });
  const changed: TableChange[] = [];
  for (const t of Object.values(to.tables)) {
    const before = from.tables[t.name];
    const change = before && tableChange(provider, before, t);
    if (change) {
      changed.push(change);
    }
  }
  if (!created.length && !dropped.length && !changed.length) {
    return { empty: true, sql: "", summary: "No difference detected.", risks: [] };
  }
  const risks = riskChecks(dropped, changed);
  const sql = provider
    .renderDiff(created, dropped, changed)
    .map(([comment, statements]) => {
      return `-- ${comment}\n${statements.join("\n")}`;
    })
    .join("\n\n");
  return { empty: false, sql: sql + "\n", summary: summarize(created, dropped, changed), risks };
}

function riskChecks(dropped: DbTable[], changed: TableChange[]): RiskCheck[] {
  const risks: RiskCheck[] = dropped.map((t) => {
    return { kind: "dropTable", table: t.name };
  });
  for (const c of changed) {
    for (const col of c.droppedColumns) {
      risks.push({ kind: "dropColumn", table: c.name, column: col.name });
    }
    for (const col of c.addedColumns) {
      if (!col.nullable && col.default === null && !col.auto) {
        risks.push({ kind: "addRequired", table: c.name, column: col.name });
      }
    }
    for (const { from, to, changes } of c.alteredColumns) {
      if (changes.includes("type")) {
        risks.push({
          kind: "alterType",
          table: c.name,
          column: to.name,
          from: from.type,
          to: to.type,
        });
      }
      if (from.nullable && !to.nullable) {
        risks.push({ kind: "makeRequired", table: c.name, column: to.name });
      }
    }
    for (const u of [
      ...c.addedUniques,
      ...c.addedIndexes.filter((i) => {
        return i.unique;
      }),
    ]) {
      risks.push({ kind: "addUnique", table: c.name, columns: u.columns });
    }
  }
  return risks;
}

export function summarize(created: readonly { name: string }[], dropped: readonly { name: string }[], changed: TableChange[]): string {
  const out: string[] = [];
  if (created.length) {
    out.push(
      "[+] Added tables\n" +
        created
          .map((t) => {
            return `  - ${t.name}`;
          })
          .join("\n"),
    );
  }
  if (dropped.length) {
    out.push(
      "[-] Removed tables\n" +
        dropped
          .map((t) => {
            return `  - ${t.name}`;
          })
          .join("\n"),
    );
  }
  const cols = (c: string[]) => {
    return "(" + c.join(", ") + ")";
  };
  for (const c of changed) {
    const lines = [`[*] Changed the \`${c.name}\` table`];
    for (const col of c.addedColumns) {
      lines.push(`  [+] Added column \`${col.name}\``);
    }
    for (const col of c.droppedColumns) {
      lines.push(`  [-] Removed column \`${col.name}\``);
    }
    for (const col of c.alteredColumns) {
      lines.push(`  [*] Altered column \`${col.to.name}\` (changed ${col.changes.join(", ")})`);
    }
    if (c.primaryKey) {
      lines.push("  [*] Changed the primary key");
    }
    if (c.comment) {
      lines.push("  [*] Changed the table comment");
    }
    for (const u of c.addedUniques) {
      lines.push(`  [+] Added unique constraint on columns ${cols(u.columns)}`);
    }
    for (const u of c.droppedUniques) {
      lines.push(`  [-] Removed unique constraint on columns ${cols(u.columns)}`);
    }
    for (const i of c.addedIndexes) {
      lines.push(`  [+] Added ${i.unique ? "unique " : ""}index on columns ${cols(i.columns)}`);
    }
    for (const i of c.droppedIndexes) {
      lines.push(`  [-] Removed ${i.unique ? "unique " : ""}index on columns ${cols(i.columns)}`);
    }
    for (const k of c.addedChecks) {
      lines.push(`  [+] Added check constraint ${k.expression}`);
    }
    for (const k of c.droppedChecks) {
      lines.push(`  [-] Removed check constraint ${k.expression}`);
    }
    for (const f of c.addedForeignKeys) {
      lines.push(`  [+] Added foreign key on columns ${cols(f.columns)}`);
    }
    for (const f of c.droppedForeignKeys) {
      lines.push(`  [-] Removed foreign key on columns ${cols(f.columns)}`);
    }
    out.push(lines.join("\n"));
  }
  return out.join("\n\n");
}

interface RiskReport {
  warnings: string[];
  unexecutable: string[];
}

/**
 * 针对迁移将运行的数据库评估数据相关风险。
 * Evaluates data-dependent risks against the database the migration will run on.
 */
export async function evaluateRisks(conn: Connection, risks: RiskCheck[]): Promise<RiskReport> {
  const q = conn.provider.quote;
  const report: RiskReport = { warnings: [], unexecutable: [] };
  const count = async (table: string, where = "") => {
    const [row] = await conn.query(`SELECT COUNT(*) AS n FROM ${q(table)}${where}`);
    return Number(row.n);
  };
  for (const r of risks) {
    if (r.kind === "dropTable") {
      const n = await count(r.table);
      if (n) {
        report.warnings.push(`You are about to drop the \`${r.table}\` table, which is not empty (${n} rows).`);
      }
    } else if (r.kind === "dropColumn") {
      const n = await count(r.table, ` WHERE ${q(r.column)} IS NOT NULL`);
      if (n) {
        report.warnings.push(`You are about to drop the column \`${r.column}\` on the \`${r.table}\` table, which still contains ${n} non-null values.`);
      }
    } else if (r.kind === "alterType") {
      const n = await count(r.table, ` WHERE ${q(r.column)} IS NOT NULL`);
      if (n) {
        report.warnings.push(`You are about to alter the column \`${r.column}\` on the \`${r.table}\` table, which contains ${n} non-null values. The data in that column will be cast from \`${r.from}\` to \`${r.to}\`.`);
      }
    } else if (r.kind === "addRequired") {
      const n = await count(r.table);
      if (n) {
        report.unexecutable.push(`Added the required column \`${r.column}\` to the \`${r.table}\` table without a default value. There are ${n} rows in this table, it is not possible to execute this step.`);
      }
    } else if (r.kind === "makeRequired") {
      const n = await count(r.table, ` WHERE ${q(r.column)} IS NULL`);
      if (n) {
        report.unexecutable.push(`Made the column \`${r.column}\` on table \`${r.table}\` required, but there are ${n} existing NULL values.`);
      }
    } else if (await count(r.table)) {
      report.warnings.push(`A unique constraint covering the columns \`[${r.columns.join(",")}]\` on the table \`${r.table}\` will be added. If there are existing duplicate values, this will fail.`);
    }
  }
  return report;
}
