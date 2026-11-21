import type { Engine } from "./engine.js";
import { internalPrimaryKey, type Table, type Relation } from "../schema/model.js";
import { visibleWhere } from "../query/predicates.js";
import { OrmError, fail, guardMassWrite, checkObject, checkOptions, requireWhere, safeInteger, decodeBigInt } from "../shared/index.js";

// ─── Row keys ──────────────────────────────────────────────────────────────
/**
 * 行的主键值，可直接用作唯一 `where`。
 * Values of a row's primary key, usable as a unique `where`.
 */
export const keyOf = (t: Table, row: any) => {
  return Object.fromEntries(
    internalPrimaryKey(t).map((key) => {
      return [key, row[key]];
    }),
  );
};
/**
 * 无 RETURNING 时插入行的唯一 `where`：使用模型标量类型中生成的标识
 * （不做有损 number 转换），否则使用已写入的键值。
 * Unique `where` of a row inserted without RETURNING: the generated identity in the model's
 * scalar type (no lossy number conversion), otherwise the key values that were written.
 */
export const insertedKey = (t: Table, insertId: unknown, values: any) => {
  if (!t.primary || !t.columns[t.primary].auto) {
    return keyOf(t, values);
  }
  return {
    [t.primary]: t.columns[t.primary].type === "bigint" ? decodeBigInt(insertId) : safeInteger(insertId),
  };
};
/**
 * 从 `t` 视角描述的隐式多对多中间表。
 * Implicit many-to-many junction table, seen from `t`.
 */
export function junctionTable(t: Table, target: Table, r: Relation): Table {
  const { map: _source, ...source } = t.columns[r.source];
  const { map: _target, ...foreign } = target.columns[r.foreign];
  return {
    name: r.junction!,
    primary: "",
    relations: {},
    columns: {
      [r.junctionSource!]: {
        ...source,
        name: r.junctionSource!,
        primary: false,
        auto: false,
        unique: false,
      },
      [r.junctionTarget!]: {
        ...foreign,
        name: r.junctionTarget!,
        primary: false,
        auto: false,
        unique: false,
      },
    },
    unique: [],
    indexes: [],
  };
}

// ─── Bulk writes ───────────────────────────────────────────────────────────
/**
 * 按输入顺序保留连续分组，使重复项解析具有确定性。
 * Keep contiguous groups in input order so duplicate resolution is deterministic.
 */
export async function createMany(e: Engine, t: Table, args: any, returning = false) {
  checkOptions(args, "createMany", "data", "skipDuplicates", ...(returning ? ["select", "include", "omit"] : []));
  if (!Array.isArray(args.data)) {
    fail("data requires array");
  }
  if (args.skipDuplicates !== undefined && typeof args.skipDuplicates !== "boolean") {
    fail("skipDuplicates requires boolean");
  }
  const projection = { select: args.select, include: args.include, omit: args.omit };
  if (returning) {
    e.validate(t, projection);
  }
  let count = 0;
  const output: any[] = [];
  let batch: Record<string, any>[] = [];
  let signature = "";
  const flush = async () => {
    if (!batch.length) {
      return;
    }
    // Without RETURNING, insert row by row and read each row back by its key.
    // Duplicate errors do not abort the transaction there, so catch only unique violations;
    // an insert-ignore hint would also suppress invalid values and foreign-key errors.
    if (!e.adapter.capabilities.returning && (args.skipDuplicates || returning)) {
      for (const row of batch) {
        let inserted;
        try {
          inserted = await e.execute({
            kind: "insert-many",
            table: t,
            rows: [row],
            returning: false,
          });
        } catch (error) {
          const translated = e.adapter.translate(error);
          if (!args.skipDuplicates || !(translated instanceof OrmError) || translated.code !== "UNIQUE_CONSTRAINT") {
            throw error;
          }
          continue;
        }
        count += inserted.affectedRows;
        if (returning) {
          output.push(await e.locate(t, insertedKey(t, inserted.insertId, row)));
        }
      }
    } else {
      const result = await e.execute({
        kind: "insert-many",
        table: t,
        rows: batch,
        skipDuplicates: args.skipDuplicates,
        returning,
      });
      count += result.affectedRows;
      if (returning) {
        output.push(...e.decodeRows(t, result.rows));
      }
    }
    batch = [];
  };
  for (const input of args.data) {
    checkObject(input, "data item");
    const row: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      const column = t.columns[key];
      if (!column) {
        fail("Bulk writes require scalar fields: " + key);
      }
      if (column.auto) {
        fail("Cannot assign generated " + key);
      }
      if (key === t.softDelete && value !== undefined && value !== null) {
        fail("New records must not be soft deleted");
      }
      if (value !== undefined) {
        row[key] = value;
      }
    }
    e.defaults(t, row);
    // Literal defaults make heterogeneous input share one statement; generated defaults
    // (now/uuid) were evaluated by defaults(), and auto columns stay omitted.
    for (const column of Object.values(t.columns)) {
      if (row[column.name] === undefined && column.default !== undefined && (column.default === null || typeof column.default !== "object")) {
        row[column.name] = column.default;
      }
    }
    await e.checkReferences(t, row);
    const keys = Object.keys(row).sort();
    const next = JSON.stringify(keys);
    // Conservative common parameter budget; default-only inserts need a separate statement.
    if (next !== signature || batch.length >= Math.max(1, Math.floor(900 / Math.max(1, keys.length))) || !keys.length) {
      await flush();
    }
    signature = next;
    batch.push(
      Object.fromEntries(
        keys.map((key) => {
          return [key, row[key]];
        }),
      ),
    );
  }
  await flush();
  return returning ? e.project(t, output, projection) : { count };
}

/**
 * 指向父行的嵌套行；调用方不能自行提供父级关联。
 * A nested row pointed at its parent; the caller cannot supply the parent link itself.
 */
export function childOf(r: Relation, parent: any, item: any) {
  if (Object.hasOwn(item, r.foreign) || (r.discriminator !== undefined && Object.hasOwn(item, r.discriminator))) {
    fail("Nested create cannot override parent");
  }
  return {
    ...item,
    [r.foreign]: parent[r.source],
    ...(r.discriminator ? { [r.discriminator]: r.discriminatorValue } : {}),
  };
}
/**
 * 父行下的嵌套 `createMany`。
 * Nested `createMany` under a parent row.
 */
export function createChildren(e: Engine, target: Table, r: Relation, parent: any, input: any) {
  checkObject(input, "createMany");
  if (
    Object.keys(input).some((k) => {
      return !["data", "skipDuplicates"].includes(k);
    }) ||
    !Array.isArray(input.data)
  ) {
    fail("createMany requires data array");
  }
  const data = input.data.map((item: any) => {
    checkObject(item, "createMany data");
    return childOf(r, parent, item);
  });
  return createMany(e, target, { ...input, data });
}

export async function updateMany(e: Engine, t: Table, args: any, returning = false, maxAffected?: number) {
  const operation = returning ? "updateManyAndReturn" : "updateMany";
  checkOptions(args, "updateMany", "where", "data", ...(returning ? ["select", "include", "omit"] : []));
  requireWhere(args, operation);
  const projection = { select: args.select, include: args.include, omit: args.omit };
  e.validate(t, { where: args.where, ...projection });
  const data = e.updateValues(t, args.data);
  const count = returning ? 0 : await e.count(t, { where: args.where });
  const matched = returning && maxAffected !== undefined ? await e.count(t, { where: args.where }) : count;
  guardMassWrite(operation, t.name, matched, maxAffected);
  if (!Object.keys(data).length) {
    return returning ? e.find(t, { where: args.where, ...projection }) : { count };
  }
  const references = Object.values(t.relations).some((r) => {
    return (
      r.owner &&
      !r.many &&
      // Polymorphic owners have no target table, so target-side soft-delete policies do not apply.
      !r.polymorphic &&
      e.schema.tables[r.target].softDelete &&
      Object.hasOwn(data, r.source)
    );
  });
  let output: any[] = [];
  // Without RETURNING, returning updates and arithmetic (checked for safe integers) select the
  // matching keys first and update each row inside the same transaction.
  if (
    references ||
    (!e.adapter.capabilities.returning &&
      (returning ||
        Object.values(data).some((v: any) => {
          return v.kind === "arithmetic";
        })))
  ) {
    const rows = await e.find(t, {
      where: args.where,
      select: Object.fromEntries(
        internalPrimaryKey(t).map((key) => {
          return [key, true];
        }),
      ),
    });
    for (const row of rows) {
      const updated = await e.update(t, keyOf(t, row), args.data);
      if (returning) {
        output.push(updated);
      }
    }
  } else {
    const result = await e.execute({
      kind: "update",
      table: t,
      where: visibleWhere(args.where),
      data,
    });
    output = e.decodeRows(t, result.rows);
  }
  return returning ? e.project(t, output, projection) : { count };
}
