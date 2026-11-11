import type { Connection, MigrationProvider } from "./provider.js";
import type { DbCheck, DbColumn, DbConstraint, DbForeignKey, DbIndex, DbModel, DbTable } from "./introspect.js";

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
    change.addedColumns.length ||
    change.droppedColumns.length ||
    change.alteredColumns.length ||
    change.primaryKey ||
    change.addedUniques.length ||
    change.droppedUniques.length ||
    change.addedIndexes.length ||
    change.droppedIndexes.length ||
    change.addedChecks.length ||
    change.droppedChecks.length ||
    change.addedForeignKeys.length ||
    change.droppedForeignKeys.length;
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

function summarize(created: DbTable[], dropped: DbTable[], changed: TableChange[]): string {
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

/** Evaluates data-dependent risks against the database the migration will run on. */
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
