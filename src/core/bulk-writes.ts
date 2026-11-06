import { keyOf, type Engine } from './engine.js';
import { primaryKey, type Table } from '../schema/index.js';
import { visibleWhere } from '../query/visibility.js';
import { OrmError, fail } from '../shared/errors.js';
import { checkObject } from '../shared/validation.js';
import { safeInteger } from '../shared/scalars.js';

/** Keep contiguous groups in input order so duplicate resolution is deterministic. */
export async function createMany(e: Engine, t: Table, args: any, returning = false) {
  checkObject(args, 'createMany');
  const allowed = returning
    ? ['data', 'skipDuplicates', 'select', 'include', 'omit']
    : ['data', 'skipDuplicates'];
  if (Object.keys(args).some((k) => !allowed.includes(k))) fail('Unknown createMany option');
  if (!Array.isArray(args.data)) fail('data requires array');
  if (args.skipDuplicates !== undefined && typeof args.skipDuplicates !== 'boolean')
    fail('skipDuplicates requires boolean');
  const projection = { select: args.select, include: args.include, omit: args.omit };
  if (returning) e.validate(t, projection);
  let count = 0;
  const output: any[] = [];
  let batch: Record<string, any>[] = [];
  let signature = '';
  const flush = async () => {
    if (!batch.length) return;
    // Without RETURNING, insert row by row and read each row back by its key.
    // Duplicate errors do not abort the transaction there, so catch only unique violations;
    // an insert-ignore hint would also suppress invalid values and foreign-key errors.
    if (
      !e.adapter.capabilities.returning &&
      (args.skipDuplicates || returning)
    ) {
      for (const row of batch) {
        let inserted;
        try {
          inserted = await e.execute({ kind: 'insert-many', table: t, rows: [row], returning: false });
        } catch (error) {
          const translated = e.adapter.translate(error);
          if (
            !args.skipDuplicates ||
            !(translated instanceof OrmError) ||
            translated.code !== 'UNIQUE_CONSTRAINT'
          )
            throw error;
          continue;
        }
        count += inserted.affectedRows;
        if (returning)
          output.push(
            await e.locate(
              t,
              t.primary && t.columns[t.primary].auto
                ? { [t.primary]: safeInteger(inserted.insertId) }
                : keyOf(t, row),
            ),
          );
      }
    } else {
      const result = await e.execute({
        kind: 'insert-many',
        table: t,
        rows: batch,
        skipDuplicates: args.skipDuplicates,
        returning,
      });
      count += result.affectedRows;
      if (returning) output.push(...e.decodeRows(t, result.rows));
    }
    batch = [];
  };
  for (const input of args.data) {
    checkObject(input, 'data item');
    const row: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      const column = t.columns[key];
      if (!column) fail('Bulk writes require scalar fields: ' + key);
      if (column.auto) fail('Cannot assign generated ' + key);
      if (key === t.softDelete && value !== undefined && value !== null)
        fail('New records must not be soft deleted');
      if (value !== undefined) row[key] = value;
    }
    e.defaults(t, row);
    // Literal defaults make heterogeneous input share one statement; generated defaults
    // (now/uuid) were evaluated by defaults(), and auto columns stay omitted.
    for (const column of Object.values(t.columns))
      if (
        row[column.name] === undefined &&
        column.default !== undefined &&
        (column.default === null || typeof column.default !== 'object')
      )
        row[column.name] = column.default;
    await e.checkReferences(t, row);
    const keys = Object.keys(row).sort();
    const next = JSON.stringify(keys);
    // Conservative common parameter budget; default-only inserts need a separate statement.
    if (
      next !== signature ||
      batch.length >= Math.max(1, Math.floor(900 / Math.max(1, keys.length))) ||
      !keys.length
    )
      await flush();
    signature = next;
    batch.push(Object.fromEntries(keys.map((key) => [key, row[key]])));
  }
  await flush();
  return returning ? e.project(t, output, projection) : { count };
}

export async function updateMany(e: Engine, t: Table, args: any, returning = false) {
  checkObject(args, 'updateMany');
  const allowed = returning ? ['where', 'data', 'select', 'include', 'omit'] : ['where', 'data'];
  if (Object.keys(args).some((k) => !allowed.includes(k))) fail('Unknown updateMany option');
  const projection = { select: args.select, include: args.include, omit: args.omit };
  e.validate(t, { where: args.where, ...projection });
  const data = e.updateValues(t, args.data);
  const count = returning ? 0 : await e.count(t, { where: args.where });
  if (!Object.keys(data).length)
    return returning ? e.find(t, { where: args.where, ...projection }) : { count };
  const references = Object.values(t.relations).some(
    (r) =>
      r.owner && !r.many && e.schema.tables[r.target].softDelete && Object.hasOwn(data, r.source),
  );
  let output: any[] = [];
  // Without RETURNING, returning updates and arithmetic (checked for safe integers) select the
  // matching keys first and update each row inside the same transaction.
  if (
    references ||
    (!e.adapter.capabilities.returning &&
      (returning || Object.values(data).some((v: any) => v.kind === 'arithmetic')))
  ) {
    const rows = await e.find(t, {
      where: args.where,
      select: Object.fromEntries(primaryKey(t).map((key) => [key, true])),
    });
    for (const row of rows) {
      const updated = await e.update(t, keyOf(t, row), args.data);
      if (returning) output.push(updated);
    }
  } else {
    const result = await e.execute({
      kind: 'update',
      table: t,
      where: visibleWhere(args.where),
      data,
    });
    output = e.decodeRows(t, result.rows);
  }
  return returning ? e.project(t, output, projection) : { count };
}
