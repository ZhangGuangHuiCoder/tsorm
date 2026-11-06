import { createMany } from './bulk-writes.js';
import { junctionTable, keyOf, type Engine } from './engine.js';
import { primaryKey, type Table, type Relation } from '../schema/index.js';
import { fail, OrmError } from '../shared/errors.js';
import { checkObject } from '../shared/validation.js';
export async function relationUpdate(
  engine: Engine,
  table: Table,
  parent: any,
  relation: Relation,
  operations: any,
  depth: number,
) {
  checkObject(operations, 'relation update');
  const names = Object.keys(operations);
  const supported = [
    'update',
    'delete',
    'disconnect',
    'set',
    'connect',
    'create',
    'connectOrCreate',
    'upsert',
    'updateMany',
    'deleteMany',
    'createMany',
  ];
  if (!names.length || names.some((name) => !supported.includes(name)))
    fail('Unknown nested relation operation');
  if (names.length > 1) {
    if (!relation.many) fail('Single relation accepts one nested operation');
    for (const name of [
      'set',
      'disconnect',
      'delete',
      'deleteMany',
      'connect',
      'connectOrCreate',
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
    ]) {
      if (Object.hasOwn(operations, name))
        await relationUpdate(engine, table, parent, relation, { [name]: operations[name] }, depth);
    }
    return;
  }
  const op = names[0];
  const value = operations[op];
  const target = engine.schema.tables[relation.target];
  const list = (v: any) => (Array.isArray(v) ? v : [v]);
  const projected = await engine.project(table, [parent], { include: { [relation.name]: true } });
  const current = relation.many
    ? projected[0][relation.name]
    : projected[0][relation.name]
      ? [projected[0][relation.name]]
      : [];
  // Rows are compared by every primary-key column, so composite keys work too.
  const same = (a: any, b: any) =>
    primaryKey(target).every(
      (key) =>
        engine.adapter.dialect.groupKey(target.columns[key], a[key]) ===
        engine.adapter.dialect.groupKey(target.columns[key], b[key]),
    );
  const member = async (where: any) => {
    const row = await engine.locate(target, where);
    if (!current.some((item: any) => same(item, row)))
      throw new OrmError('RELATION_NOT_CONNECTED', 'Record is not connected to ' + relation.name);
    return row;
  };
  const junction = () => junctionTable(table, target, relation);
  const detach = async (row: any) => {
    if (relation.junction)
      await engine.execute({
        kind: 'delete',
        table: junction(),
        where: {
          [relation.junctionSource!]: parent[relation.source],
          [relation.junctionTarget!]: row[relation.foreign],
        },
      });
    else if (relation.owner) {
      if (!table.columns[relation.source].nullable) fail('Cannot disconnect a required relation');
      await engine.update(
        table,
        keyOf(table, parent),
        { [relation.source]: null },
        depth + 1,
      );
    } else {
      if (!target.columns[relation.foreign].nullable) fail('Cannot disconnect a required relation');
      await engine.update(
        target,
        keyOf(target, row),
        { [relation.foreign]: null },
        depth + 1,
      );
    }
  };
  const attach = async (row: any) => {
    if (current.some((item: any) => same(item, row))) return;
    if (relation.junction)
      await engine.execute({
        kind: 'insert',
        table: junction(),
        data: {
          [relation.junctionSource!]: parent[relation.source],
          [relation.junctionTarget!]: row[relation.foreign],
        },
      });
    else if (relation.owner)
      await engine.update(
        table,
        keyOf(table, parent),
        { [relation.source]: row[relation.foreign] },
        depth + 1,
      );
    else {
      if (
        row[relation.foreign] !== null &&
        engine.adapter.dialect.groupKey(table.columns[relation.source], row[relation.foreign]) !==
          engine.adapter.dialect.groupKey(table.columns[relation.source], parent[relation.source])
      )
        fail('Cannot reparent via inverse connect');
      await engine.update(
        target,
        keyOf(target, row),
        { [relation.foreign]: parent[relation.source] },
        depth + 1,
      );
    }
  };
  if (op === 'connectOrCreate' || op === 'upsert') {
    for (const input of relation.many ? list(value) : [value]) {
      checkObject(input, op);
      if (Object.keys(input).some((k) => !['where', 'create', 'update'].includes(k)))
        fail('Unknown nested ' + op + ' option');
      let row;
      if (op === 'connectOrCreate' || relation.many) {
        try {
          row = await engine.locate(target, input.where);
        } catch (error) {
          if (!(error instanceof OrmError) || error.code !== 'NOT_FOUND') throw error;
        }
      } else row = current[0];
      if (op === 'connectOrCreate') {
        await relationUpdate(
          engine,
          table,
          parent,
          relation,
          row ? { connect: input.where } : { create: input.create },
          depth,
        );
      } else {
        const connected =
          row && current.some((item: any) => same(item, row));
        if (connected)
          await engine.update(
            target,
            keyOf(target, row),
            input.update,
            depth + 1,
          );
        else await relationUpdate(engine, table, parent, relation, { create: input.create }, depth);
      }
    }
    return;
  }
  if (['updateMany', 'deleteMany', 'createMany'].includes(op)) {
    if (!relation.many) fail(op + ' requires a many relation');
    if (op === 'createMany') {
      if (relation.junction) fail('Nested createMany requires a direct foreign-key relation');
      checkObject(value, 'createMany');
      if (
        Object.keys(value).some((k) => !['data', 'skipDuplicates'].includes(k)) ||
        !Array.isArray(value.data)
      )
        fail('createMany requires data array');
      const data = value.data.map((item: any) => {
        checkObject(item, 'createMany data');
        if (Object.hasOwn(item, relation.foreign)) fail('Nested create cannot override parent');
        return { ...item, [relation.foreign]: parent[relation.source] };
      });
      await createMany(engine, target, { ...value, data });
    } else {
      for (const input of list(value)) {
        checkObject(input, op);
        if (op === 'updateMany') {
          if (Object.keys(input).some((k) => !['where', 'data'].includes(k)))
            fail('Unknown updateMany option');
          engine.updateValues(target, input.data);
        }
        const where = op === 'updateMany' ? input.where : input;
        for (let start = 0; start < current.length; start += 200) {
          const keys = current.slice(start, start + 200).map((row: any) => keyOf(target, row));
          const rows = await engine.find(target, {
            where: { AND: [where ?? {}, { OR: keys }] },
          });
          for (const row of rows) {
            if (op === 'updateMany')
              await engine.update(
                target,
                keyOf(target, row),
                input.data,
                depth + 1,
              );
            else
              await engine.execute({
                kind: 'delete',
                table: target,
                where: keyOf(target, row),
              });
          }
        }
      }
    }
    return;
  }
  if (op === 'update') {
    for (const item of relation.many ? list(value) : [value]) {
      checkObject(item, 'nested update');
      const row = relation.many ? await member(item.where) : current[0];
      if (!row) throw new OrmError('NOT_FOUND', 'Related record not found');
      await engine.update(
        target,
        keyOf(target, row),
        relation.many ? item.data : item,
        depth + 1,
      );
    }
  } else if (op === 'delete' || op === 'disconnect') {
    if (op === 'delete' && !relation.many && !relation.nullable)
      fail('Cannot delete a required relation');
    if (!relation.many && value !== true) fail('Single relation operation requires true');
    const rows = [];
    if (relation.many) {
      for (const where of list(value)) rows.push(await member(where));
    } else rows.push(...current);
    for (const row of rows) {
      if (op === 'disconnect') await detach(row);
      else {
        if (relation.owner && !target.softDelete) await detach(row);
        if (relation.junction && !target.softDelete) await detach(row);
        await engine.execute({
          kind: 'delete',
          table: target,
          where: keyOf(target, row),
        });
      }
    }
  } else if (op === 'set') {
    if (!relation.many || !Array.isArray(value)) fail('set requires a many relation and an array');
    const rows = [];
    for (const where of value) rows.push(await engine.locate(target, where));
    for (const row of current)
      if (!rows.some((item) => same(item, row))) await detach(row);
    for (const row of rows) await attach(row);
  } else if (op === 'connect') {
    if (!relation.many && Array.isArray(value)) fail('Single relation takes one record');
    for (const where of list(value)) await attach(await engine.locate(target, where));
  } else {
    if (!relation.many && Array.isArray(value)) fail('Single relation takes one record');
    if (!relation.many && !relation.owner && current.length) fail('Single relation already exists');
    for (const data of list(value)) {
      checkObject(data, 'nested create');
      if (!relation.owner && !relation.junction) {
        if (
          Object.hasOwn(data, relation.foreign) ||
          Object.values(target.relations).some(
            (r) => r.owner && r.source === relation.foreign && Object.hasOwn(data, r.name),
          )
        )
          fail('Nested create cannot override parent');
        await engine.create(
          target,
          { ...data, [relation.foreign]: parent[relation.source] },
          depth + 1,
        );
      } else await attach(await engine.create(target, data, depth + 1));
    }
  }
}
