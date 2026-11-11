import { jsonTypeText } from "../shared/json.js";
import { primaryKey, type Schema, type Column } from "./index.js";
function ts(c: Column, input = false): string {
  if (c.type === "json") {
    const inner = input ? "JsonInput<" + jsonTypeText(c.json!.root) + "," + c.nullable + ">" : jsonTypeText(c.json!.root);
    return inner + (c.nullable ? " | null" : "");
  }
  let base: string;
  if (c.enum) {
    base = c.enum
      .map((x) => {
        return JSON.stringify(x);
      })
      .join(" | ");
  } else if (c.type === "int") {
    base = "number";
  } else if (c.type === "bigint") {
    base = input ? "bigint | string | number" : "string";
  } else if (c.type === "decimal") {
    base = input ? "string | number" : "string";
  } else if (c.type === "text") {
    base = "string";
  } else if (c.type === "datetime") {
    base = input ? "DateTimeInput" : "DateTime";
  } else if (c.type === "bytes") {
    base = "Uint8Array";
  } else {
    base = c.type;
  }
  return base + (c.nullable ? " | null" : "");
}
const capitalize = (name: string) => {
  return name[0].toUpperCase() + name.slice(1);
};
export function generateClient(schema: Schema, runtimeImport = "@ofis/tsorm"): string {
  /**
   * Named helper types (nested relation inputs and "create without the parent" variants), so
   * editor hovers show `UserCreatePostsInput` instead of expanding every nested operation.
   */
  const named = new Map<string, string>();
  const taken = new Set([
    ...Object.keys(schema.tables),
    ...Object.keys(schema.jsonTypes ?? {}),
    ...Object.keys(schema.tables).flatMap((name) => {
      return ["Row", "Create", "Update", "Unique", "ScalarCreate", "ScalarUpdate"].map((suffix) => {
        return name + suffix;
      });
    }),
  ]);
  const define = (name: string, body: string): string => {
    const existing = named.get(name);
    if (existing === undefined) {
      if (taken.has(name)) {
        throw new Error(`Generated type name ${name} collides with a model or type`);
      }
      named.set(name, body);
    } else if (existing !== body) {
      throw new Error(`Generated type name ${name} is ambiguous`);
    }
    return name;
  };
  /** The target's create input minus the fields that point back at the parent. */
  const createWithout = (target: string, keys: string[], back: string) => {
    return define(
      `${target}CreateWithout${capitalize(back)}`,
      `DistributiveOmit<${target}Create, ${keys
        .map((k) => {
          return JSON.stringify(k);
        })
        .join(" | ")}>`,
    );
  };
  const lines = [
    `// Generated from schema.orm. Do not edit.`,
    `import { createClient as createORMClient } from ${JSON.stringify(runtimeImport)};`,
    `import type { Schema, ClientOptions, FieldUpdate, DecimalUpdate, Where, DateTime, DateTimeInput, JsonInput, Invalid } from ${JSON.stringify(runtimeImport)};`,
  ];
  for (const [name, shape] of Object.entries(schema.jsonTypes ?? {})) {
    lines.push("export type " + name + " = " + jsonTypeText(shape) + ";");
  }
  for (const t of Object.values(schema.tables)) {
    lines.push(
      `export type ${t.name}Row = {`,
      ...Object.values(t.columns).map((c) => {
        return `  ${JSON.stringify(c.name)}: ${ts(c)};`;
      }),
      "};",
    );
    const scalar = Object.values(t.columns).filter((c) => {
      return (
        !c.auto &&
        c.name !== t.softDelete &&
        !Object.values(t.relations).some(
          // 多态持有方不占用列：判别列与主键列按普通标量出入。
          (r) => {
            return r.owner && !r.many && !r.polymorphic && r.source === c.name;
          },
        )
      );
    });
    const base = scalar
      .map((c) => {
        return `${JSON.stringify(c.name)}${c.default !== undefined || c.updatedAt ? "?" : ""}: ${ts(c, true)}`;
      })
      .join("; ");
    // 标量列可能全部由关系管理（base 为空），此时不能留下孤立的分号。
    const autos = Object.values(t.columns)
      .filter((c) => {
        return c.auto;
      })
      .map((c) => {
        return JSON.stringify(c.name) + "?: never";
      });
    const parts = [`{ ${[base, ...autos].filter(Boolean).join("; ")} }`];
    const relationFields: string[] = [];
    for (const r of Object.values(t.relations)) {
      // 多态持有方不进入创建输入：判别列与主键列已是普通标量，正向 include 被运行期拒绝。
      if (r.polymorphic && r.owner) {
        continue;
      }
      const target = schema.tables[r.target];
      const rel = JSON.stringify(r.name);
      const inputName = `${t.name}Create${capitalize(r.name)}Input`;
      if (r.owner && !r.many) {
        const fk = JSON.stringify(r.source);
        const col = t.columns[r.source];
        const input = define(inputName, `OneOf<{ create: ${r.target}Create; connect: ${r.target}Unique; connectOrCreate: { where: ${r.target}Unique; create: ${r.target}Create } }>`);
        // The relation member comes first: TypeScript reports a failed union against its last
        // member, so a missing value reads "Property 'authorId' is missing", the usual fix.
        const both = `Invalid<${JSON.stringify(`Use either ${r.source} or ${r.name}, not both`)}>`;
        parts.push(`({ ${fk}?: ${both}; ${rel}: ${input} } | { ${fk}${r.nullable ? "?" : ""}: ${ts(col, true)}; ${rel}?: ${both} })`);
      } else {
        // 多态反向：固定省略判别列与主键列，v1 不提供 connect 族操作。
        const polymorphic = !!r.polymorphic;
        const reverse = polymorphic
          ? undefined
          : Object.values(target.relations).find((x) => {
              return x.owner && !x.many && x.source === r.foreign && x.target === t.name;
            });
        let parentKeys: string[];
        if (polymorphic) {
          parentKeys = [r.foreign, r.discriminator!];
        } else if (reverse) {
          parentKeys = [r.foreign, reverse.name];
        } else {
          parentKeys = [r.foreign];
        }
        let back = r.foreign;
        if (polymorphic) {
          back = r.name;
        } else if (reverse) {
          back = reverse.name;
        }
        const create = r.junction ? `${r.target}Create` : createWithout(r.target, parentKeys, back);
        const operations = [`create: ${create}${r.many ? " | (" + create + ")[]" : ""}`];
        if (!polymorphic) {
          const connectOrCreate = `{ where: ${r.target}Unique; create: ${create} }`;
          operations.push(`connect: ${r.target}Unique${r.many ? " | " + r.target + "Unique[]" : ""}`, `connectOrCreate: ${connectOrCreate}${r.many ? " | " + connectOrCreate + "[]" : ""}`);
        }
        if (r.many && !r.junction) {
          let scalarKeys = JSON.stringify(r.foreign);
          if (polymorphic) {
            scalarKeys = [r.foreign, r.discriminator!]
              .map((k) => {
                return JSON.stringify(k);
              })
              .join(" | ");
          }
          operations.push(`createMany: { data: DistributiveOmit<${r.target}ScalarCreate, ${scalarKeys}>[]; skipDuplicates?: boolean }`);
        }
        const input = define(inputName, `${r.many ? "AtLeastOne" : "OneOf"}<{ ${operations.join("; ")} }>`);
        relationFields.push(`${rel}?: ${input}`);
      }
    }
    if (relationFields.length) {
      parts.push(`{ ${relationFields.join("; ")} }`);
    }
    lines.push(`export type ${t.name}Create = ${parts.join(" & ")};`);

    const mutableColumns = Object.values(t.columns).filter((c) => {
      return !primaryKey(t).includes(c.name) && !c.auto && c.name !== t.softDelete;
    });
    let scalarUpdates: string[];
    if (mutableColumns.length) {
      scalarUpdates = mutableColumns.map((c) => {
        return JSON.stringify(c.name) + (c.type === "decimal" ? "?: DecimalUpdate<" : "?: FieldUpdate<") + ts(c, true) + ">";
      });
    } else {
      // An empty object type accepts arbitrary values. Keep forbidden scalar keys explicit,
      // while leaving named relation inputs available in the combined Update type.
      scalarUpdates = Object.keys(t.columns).map((name) => {
        return JSON.stringify(name) + "?: never";
      });
    }
    lines.push(`export type ${t.name}ScalarUpdate = { ${scalarUpdates.join("; ")} };`);
    const relationUpdates = Object.values(t.relations)
      .filter((r) => {
        return !(r.owner && !r.many && primaryKey(t).includes(r.source));
      })
      .map((r) => {
        // 多态持有方不进入更新输入与 Models 元数据。
        if (r.polymorphic && r.owner) {
          return "";
        }
        const target = schema.tables[r.target];
        const polymorphic = !!r.polymorphic;
        const reverse = polymorphic
          ? undefined
          : Object.values(target.relations).find((x) => {
              return x.owner && !x.many && x.source === r.foreign && x.target === t.name;
            });
        let parentKeys: string[];
        if (polymorphic) {
          parentKeys = [r.foreign, r.discriminator!];
        } else if (reverse) {
          parentKeys = [r.foreign, reverse.name];
        } else {
          parentKeys = [r.foreign];
        }
        let back = r.foreign;
        if (polymorphic) {
          back = r.name;
        } else if (reverse) {
          back = reverse.name;
        }
        const nestedCreate = r.owner || r.junction ? r.target + "Create" : createWithout(r.target, parentKeys, back);
        const detachable = !!r.junction || (r.owner ? t.columns[r.source].nullable : target.columns[r.foreign].nullable);
        const item = "{where:" + r.target + "Unique;data:" + r.target + "Update}";
        const operations = ["update: " + (r.many ? item + " | " + item + "[]" : r.target + "Update"), "delete: " + (r.many ? r.target + "Unique | " + r.target + "Unique[]" : "true")];
        if (!polymorphic) {
          operations.push("connect: " + r.target + "Unique" + (r.many ? " | " + r.target + "Unique[]" : ""));
        }
        operations.push("create: " + nestedCreate + (r.many ? " | (" + nestedCreate + ")[]" : ""));
        if (!polymorphic) {
          const connectOrCreate = "{where:" + r.target + "Unique;create:" + nestedCreate + "}";
          operations.push("connectOrCreate: " + connectOrCreate + (r.many ? " | " + connectOrCreate + "[]" : ""));
        }
        const upsert = "{" + (r.many ? "where:" + r.target + "Unique;" : "") + "create:" + nestedCreate + ";update:" + r.target + "Update}";
        operations.push("upsert: " + upsert + (r.many ? " | " + upsert + "[]" : ""));
        if (r.many) {
          const updateMany = "{where?:Where<Models," + JSON.stringify(r.target) + ">;data:" + r.target + "ScalarUpdate}";
          operations.push("updateMany: " + updateMany + " | " + updateMany + "[]");
          operations.push("deleteMany: Where<Models," + JSON.stringify(r.target) + "> | Where<Models," + JSON.stringify(r.target) + ">[]");
          if (!r.junction) {
            operations.push(
              "createMany: {data:DistributiveOmit<" +
                r.target +
                "ScalarCreate," +
                (polymorphic
                  ? [r.foreign, r.discriminator!]
                      .map((k) => {
                        return JSON.stringify(k);
                      })
                      .join("|")
                  : JSON.stringify(r.foreign)) +
                ">[];skipDuplicates?:boolean}",
            );
          }
        }
        if (detachable) {
          operations.push("disconnect: " + (r.many ? r.target + "Unique | " + r.target + "Unique[]" : "true"));
        }
        if (r.many && !polymorphic) {
          operations.push("set: " + r.target + "Unique[]");
        }
        const input = define(`${t.name}Update${capitalize(r.name)}Input`, (r.many ? "AtLeastOne" : "OneOf") + "<{ " + operations.join("; ") + " }>");
        return JSON.stringify(r.name) + "?: " + input;
      })
      .filter(Boolean);
    lines.push("export type " + t.name + "Update = " + t.name + "ScalarUpdate" + (relationUpdates.length ? " & { " + relationUpdates.join("; ") + " }" : "") + ";");
    lines.push(
      "export type " +
        t.name +
        "ScalarCreate = { " +
        Object.values(t.columns)
          .map((c) => {
            if (c.auto || c.name === t.softDelete) {
              return JSON.stringify(c.name) + "?: never";
            }
            return JSON.stringify(c.name) + (c.default !== undefined || c.updatedAt ? "?" : "") + ": " + ts(c, true);
          })
          .join("; ") +
        " };",
    );
    const unique = Object.values(t.columns)
      .filter((c) => {
        return c.primary || c.unique;
      })
      .map((c) => {
        return `{ ${JSON.stringify(c.name)}: ${ts({ ...c, nullable: false }, true)} }`;
      });
    for (const keys of [...(t.primaryKey?.length ? [t.primaryKey] : []), ...t.unique]) {
      unique.push(
        `{ ${keys
          .map((k) => {
            return JSON.stringify(k) + ": " + ts({ ...t.columns[k], nullable: false }, true);
          })
          .join("; ")} }`,
      );
    }
    lines.push(`export type ${t.name}Unique = ${unique.join(" | ")};`);
  }
  for (const [name, body] of named) {
    lines.push(`export type ${name} = ${body};`);
  }
  lines.push(
    "type AtLeastOne<T> = {[K in keyof T]:Required<Pick<T,K>> & Partial<Omit<T,K>>}[keyof T];",
    "type OneOf<T> = {[K in keyof T]:{[P in K]:T[P]} & {[P in Exclude<keyof T,K>]?:never}}[keyof T];",
    "type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;",
    "export type Models = {",
  );
  for (const t of Object.values(schema.tables)) {
    lines.push(
      `${JSON.stringify(t.name)}: { row: ${t.name}Row; create: ${t.name}Create; update: ${t.name}Update; dateFields:${
        Object.values(t.columns)
          .filter((c) => {
            return c.type === "datetime";
          })
          .map((c) => {
            return JSON.stringify(c.name);
          })
          .join(" | ") || "never"
      }; bigintFields:${
        Object.values(t.columns)
          .filter((c) => {
            return c.type === "bigint";
          })
          .map((c) => {
            return JSON.stringify(c.name);
          })
          .join(" | ") || "never"
      }; decimalFields:${
        Object.values(t.columns)
          .filter((c) => {
            return c.type === "decimal";
          })
          .map((c) => {
            return JSON.stringify(c.name);
          })
          .join(" | ") || "never"
      }; jsonFields:${
        Object.values(t.columns)
          .filter((c) => {
            return c.type === "json";
          })
          .map((c) => {
            return JSON.stringify(c.name);
          })
          .join(" | ") || "never"
      }; scalarCreate:${t.name}ScalarCreate; scalarUpdate:${t.name}ScalarUpdate; unique: ${t.name}Unique; relations: { ${Object.values(t.relations)
        .filter((r) => {
          return !(r.polymorphic && r.owner);
        })
        .map((r) => {
          return `${JSON.stringify(r.name)}: { target: ${JSON.stringify(r.target)}; many: ${r.many}; nullable: ${r.nullable} }`;
        })
        .join("; ")} } };`,
    );
  }
  lines.push(
    "};",
    `export const schema: Schema = ${JSON.stringify(schema, null, 2).replace(/^(\s*)"__proto__":/gm, '$1["__proto__"]:')};`,
    "export const createClient = (options: ClientOptions) => {",
    "  return createORMClient<Models>(schema, options);",
    "};",
  );
  return lines.join("\n") + "\n";
}
