import { visibleWhere } from '../query/visibility.js';
import { relationUpdate } from './relation-writes.js';
import { randomUUID } from 'node:crypto';
import { omitted, primaryKey, type Schema, type Table, type Relation } from '../schema/index.js';
import { createMany } from './bulk-writes.js';
import type { RuntimeAdapter, Session } from './adapter.js';
import { StatementCompiler } from '../query/compiler.js';
import { nullsFirst, sortOrder } from '../query/predicates.js';
import type { Statement } from '../query/compiler.js';
import { OrmError, fail } from '../shared/errors.js';
import { checkObject } from '../shared/validation.js';
import { safeInteger } from '../shared/scalars.js';
/** Values of a row's primary key, usable as a unique `where`. */
export const keyOf = (t: Table, row: any) =>
  Object.fromEntries(primaryKey(t).map((key) => [key, row[key]]));
/** Implicit many-to-many junction table, seen from `t`. */
export function junctionTable(t: Table, target: Table, r: Relation): Table {
  const { map: _source, ...source } = t.columns[r.source];
  const { map: _target, ...foreign } = target.columns[r.foreign];
  return {
    name: r.junction!,
    primary: '',
    relations: {},
    columns: {
      [r.junctionSource!]: { ...source, name: r.junctionSource!, primary: false, auto: false, unique: false },
      [r.junctionTarget!]: { ...foreign, name: r.junctionTarget!, primary: false, auto: false, unique: false },
    },
    unique: [],
    indexes: [],
  };
}
export class Engine extends StatementCompiler {
  constructor(
    schema: Schema,
    adapter: RuntimeAdapter,
    readonly session: Session,
  ) {
    super(schema, adapter);
  }
  execute(node: Statement) {
    if (node.kind === 'delete' && node.table.softDelete) {
      if (node.physical)
        return this.session.execute(
          this.compile({ ...node, table: { ...node.table, softDelete: undefined } }),
        );
      return this.session.execute(
        this.compile({
          kind: 'update',
          table: node.table,
          where: node.where,
          data: this.updateValues(node.table, { [node.table.softDelete]: new Date() }, true),
        }),
      );
    }
    return this.session.execute(this.compile(node));
  }
  async count(t: Table, args: any = {}): Promise<number> {
    checkObject(args, 'count');
    if (Object.keys(args).some((k) => !['where', 'distinct', 'deleted'].includes(k)))
      fail('Unknown count option');
    this.validate(t, { where: args.where, distinct: args.distinct, deleted: args.deleted });
    const distinct =
      args.distinct === undefined
        ? undefined
        : Array.isArray(args.distinct)
          ? args.distinct
          : [args.distinct];
    return safeInteger(
      (
        await this.execute({
          kind: 'count',
          table: t,
          where: visibleWhere(args.where, args.deleted),
          distinct,
        })
      ).rows[0].n,
    );
  }
  async find(t: Table, args: any = {}): Promise<any[]> {
    if (Number.isSafeInteger(args?.take) && args.take < 0) {
      // Backward page: read forward in the mirrored order, then restore the requested order.
      if (args.distinct !== undefined) fail('Negative take cannot be combined with distinct');
      const mirror: Record<string, string> = { asc: 'desc', desc: 'asc', first: 'last', last: 'first' };
      const flip = (v: any): any =>
        typeof v === 'string'
          ? (mirror[v] ?? v)
          : Array.isArray(v)
              ? v.map(flip)
              : v && typeof v === 'object'
                ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flip(x)]))
                : v;
      const orderBy = [args.orderBy ?? []].flat();
      for (const key of primaryKey(t))
        if (!orderBy.some((item: any) => item && Object.hasOwn(item, key)))
          orderBy.push({ [key]: 'asc' });
      return (await this.find(t, { ...args, take: -args.take, orderBy: flip(orderBy) })).reverse();
    }
    this.validate(t, args);
    let query = args;
    if (args.cursor !== undefined) {
      for (const item of [args.orderBy ?? []].flat())
        for (const field of Object.keys(item))
          if (!t.columns[field]) fail('cursor cannot be combined with relation orderBy');
      let anchor;
      try {
        anchor = await this.locate(t, args.cursor, args.deleted);
      } catch (error) {
        if (error instanceof OrmError && error.code === 'NOT_FOUND') return [];
        throw error;
      }
      const order: any[] = [];
      for (const item of args.orderBy === undefined
        ? []
        : Array.isArray(args.orderBy)
          ? args.orderBy
          : [args.orderBy])
        for (const [field, value] of Object.entries(item)) {
          const { sort, nulls } = sortOrder(value);
          order.push([field, sort, nullsFirst(sort, nulls)]);
        }
      for (const key of primaryKey(t))
        if (!order.some(([field]) => field === key)) order.push([key, 'asc', true]);
      const prefix: any[] = [];
      const branches: any[] = [];
      // Rows after the anchor: beyond its value, then NULLs when they sort last.
      for (const [field, direction, nullsFirst] of order) {
        const value = anchor[field];
        const beyond = { [field]: { [direction === 'asc' ? 'gt' : 'lt']: value } };
        let comparison: any;
        if (value === null) comparison = nullsFirst ? { [field]: { not: null } } : { OR: [] };
        else
          comparison =
            !nullsFirst && t.columns[field].nullable ? { OR: [beyond, { [field]: null }] } : beyond;
        branches.push({ AND: [...prefix, comparison] });
        prefix.push({ [field]: value });
      }
      branches.push({ AND: prefix });
      query = { ...args, where: { AND: [args.where ?? {}, { OR: branches }] } };
    }
    const raw = (await this.execute({ kind: 'select', table: t, args: query })).rows;
    return this.project(t, this.decodeRows(t, raw), args);
  }
  decodeRows(t: Table, rows: any[]): any[] {
    if (!rows.length) return [];
    const selected = {
      ...t,
      columns: Object.fromEntries(
        Object.entries(t.columns).filter(([name]) => Object.hasOwn(rows[0], name)),
      ),
    };
    return rows.map((row) => this.adapter.dialect.decode(selected, row));
  }
  async locate(t: Table, where: any, deleted: 'exclude' | 'include' | 'only' = 'exclude') {
    this.unique(t, where);
    const row = (
      await this.execute({ kind: 'select', table: t, args: { where, deleted }, unique: true })
    ).rows[0];
    if (!row) throw new OrmError('NOT_FOUND', `${t.name} not found`);
    return this.adapter.dialect.decode(t, row);
  }
  async project(t: Table, rows: any[], args: any): Promise<any[]> {
    const d = this.adapter.dialect;
    const omit = omitted(t, args);
    const output = rows.map((row) =>
      args.select
        ? Object.fromEntries(
            Object.keys(args.select)
              .filter((k) => args.select[k] && t.columns[k])
              .map((k) => [k, row[k]]),
          )
        : Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => key !== '__orm_distinct_rank' && !omit?.[key],
            ),
          ),
    );
    for (const [name, option] of Object.entries(args.select ?? args.include ?? {})) {
      if (name === '_count') {
        if (option === false) continue;
        const selection =
          option === true
            ? Object.fromEntries(
                Object.values(t.relations)
                  .filter((r) => r.many)
                  .map((r) => [r.name, true]),
              )
            : (option as any).select;
        for (const result of output) result._count = {};
        for (const [field, filter] of Object.entries(selection)) {
          if (filter === false) continue;
          const relation = t.relations[field];
          const target = this.schema.tables[relation.target];
          const counts = new Map<string, number>();
          const keys = [
            ...new Map(
              rows
                .filter((row) => row[relation.source] !== null)
                .map((row) => [
                  d.groupKey(t.columns[relation.source], row[relation.source]),
                  row[relation.source],
                ]),
            ).values(),
          ];
          for (let start = 0; start < keys.length; start += 200) {
            const raw = (
              await this.execute({
                kind: 'relation-count',
                table: target,
                source: t,
                relation,
                keys: keys.slice(start, start + 200),
                args: filter === true ? {} : filter,
              })
            ).rows;
            for (const result of raw)
              counts.set(
                d.groupKey(t.columns[relation.source], result.__orm_parent),
                safeInteger(result.__orm_count),
              );
          }
          rows.forEach(
            (row, i) =>
              (output[i]._count[field] =
                counts.get(d.groupKey(t.columns[relation.source], row[relation.source])) ?? 0),
          );
        }
        continue;
      }
      const r = t.relations[name];
      if (!r || option === false) continue;
      const sub = option === true ? {} : (option as any);
      const target = this.schema.tables[r.target];
      const keys = [
        ...new Map(
          rows
            .filter((row) => row[r.source] !== null)
            .map((row) => [d.groupKey(t.columns[r.source], row[r.source]), row[r.source]]),
        ).values(),
      ];
      const groups = new Map<string, any[]>();
      for (let start = 0; start < keys.length; start += 200) {
        const raw = (
          await this.execute({
            kind: 'related',
            table: target,
            source: t,
            relation: r,
            keys: keys.slice(start, start + 200),
            args: sub,
          })
        ).rows;
        const nested = await this.project(target, this.decodeRows(target, raw), sub);
        raw.forEach((row, i) => {
          const key = d.groupKey(t.columns[r.source], row.__orm_parent);
          const items = groups.get(key) ?? [];
          items.push(nested[i]);
          groups.set(key, items);
        });
      }
      rows.forEach((row, i) => {
        const values =
          row[r.source] === null
            ? []
            : (groups.get(d.groupKey(t.columns[r.source], row[r.source])) ?? []);
        if (!r.many && (values.length > 1 || (!r.nullable && !values.length)))
          throw new OrmError(
            !values.length && target.softDelete ? 'SOFT_DELETED_RELATION' : 'RELATION_INTEGRITY',
            `Invalid ${t.name}.${name}`,
          );
        output[i][name] = r.many ? values : (values[0] ?? null);
      });
    }
    for (const [name, field] of Object.entries(t.virtuals ?? {})) {
      if (args.select ? !args.select[name] : omit?.[name]) continue;
      rows.forEach((row, i) => {
        const dependencies = Object.freeze(
          Object.fromEntries(field.needs.map((key) => [key, row[key]])),
        );
        const input = new Proxy(dependencies, {
          get(target, key) {
            if (typeof key === 'string' && !Object.hasOwn(target, key))
              fail('Undeclared virtual dependency ' + key);
            return Reflect.get(target, key);
          },
        });
        const value = field.compute(input);
        if (value && typeof (value as any).then === 'function') {
          Promise.resolve(value).catch(() => {});
          fail('Virtual fields must compute synchronously');
        }
        output[i][name] = value;
      });
    }
    return output;
  }
  async checkReferences(t: Table, row: any, changed?: Record<string, unknown>): Promise<void> {
    for (const relation of Object.values(t.relations)) {
      const target = this.schema.tables[relation.target];
      if (
        !relation.owner ||
        relation.many ||
        !target.softDelete ||
        row[relation.source] === null ||
        (changed && !Object.hasOwn(changed, relation.source))
      )
        continue;
      try {
        await this.locate(target, { [relation.foreign]: row[relation.source] });
      } catch (error) {
        if (error instanceof OrmError && error.code === 'NOT_FOUND')
          throw new OrmError('SOFT_DELETED_REFERENCE', 'Cannot reference a soft-deleted record');
        throw error;
      }
    }
  }
  defaults(t: Table, values: Record<string, any>): void {
    for (const c of Object.values(t.columns)) {
      if (values[c.name] === undefined) {
        if (c.default && typeof c.default === 'object' && c.default.fn === 'now')
          values[c.name] = this.encode(c, new Date());
        else if (c.default && typeof c.default === 'object' && c.default.fn === 'uuid')
          values[c.name] = randomUUID();
        else if (c.updatedAt) values[c.name] = this.encode(c, new Date());
        else if (
          !this.adapter.capabilities.returning &&
          primaryKey(t).includes(c.name) &&
          c.default !== undefined
        )
          values[c.name] = typeof c.default === 'object' ? new Date() : c.default;
        else if (!c.auto && c.default === undefined) fail(`Missing required ${c.name}`);
      }
    }
  }
  async create(t: Table, data: any, depth = 0): Promise<any> {
    if (depth > 8) fail('Maximum write depth is 8');
    checkObject(data, 'data');
    const values: any = {};
    const deferred: [Relation, any][] = [];
    for (const [k, v] of Object.entries(data)) {
      if (t.columns[k]) {
        if (k === t.softDelete && v !== null && v !== undefined)
          fail('New records must not be soft deleted');
        if (t.columns[k].auto) fail(`Cannot assign generated ${k}`);
        if (v !== undefined) values[k] = v;
        continue;
      }
      const r = t.relations[k];
      if (!r) fail(`Unknown field ${k}`);
      checkObject(v, 'relation write');
      const ops = Object.keys(v as object);
      const allowed = ['create', 'connect', 'connectOrCreate'];
      if (r.many && !r.junction) allowed.push('createMany');
      if (!ops.length || ops.some((op) => !allowed.includes(op)) || (!r.many && ops.length !== 1))
        fail(
          r.many
            ? `Nested create accepts ${allowed.join(', ')}`
            : 'Use one create, connect or connectOrCreate',
        );
      if (r.owner && !r.many) {
        if (Object.hasOwn(data, r.source)) fail(`Cannot supply both ${k} and ${r.source}`);
        const target = this.schema.tables[r.target];
        const input = (v as any)[ops[0]];
        const row =
          ops[0] === 'create'
            ? await this.create(target, input, depth + 1)
            : ops[0] === 'connect'
              ? await this.locate(target, input)
              : await this.connectOrCreate(target, input, depth);
        values[r.source] = row[r.foreign];
      } else deferred.push([r, v]);
    }
    this.defaults(t, values);
    const inserted = await this.execute({ kind: 'insert', table: t, data: values });
    const row = this.adapter.capabilities.returning
      ? this.adapter.dialect.decode(t, inserted.rows[0])
      : await this.locate(
          t,
          t.primary && t.columns[t.primary].auto
            ? { [t.primary]: safeInteger(inserted.insertId) }
            : keyOf(t, values),
        );
    await this.checkReferences(t, row);
    for (const [r, ops] of deferred) {
      const target = this.schema.tables[r.target];
      const items = (value: any) => (Array.isArray(value) ? value : [value]);
      if (!r.many)
        for (const op of ['create', 'connect', 'connectOrCreate'])
          if (ops[op] !== undefined && Array.isArray(ops[op])) fail('Single relation takes one record');
      const link = async (linked: any) => {
        if (r.junction) {
          await this.execute({
            kind: 'insert',
            table: junctionTable(t, target, r),
            data: { [r.junctionSource!]: row[r.source], [r.junctionTarget!]: linked[r.foreign] },
          });
          return;
        }
        if (linked[r.foreign] !== null && linked[r.foreign] !== row[r.source])
          fail('Cannot reparent via inverse connect');
        await this.update(target, keyOf(target, linked), { [r.foreign]: row[r.source] });
      };
      const create = async (item: any) => {
        if (r.junction) return link(await this.create(target, item, depth + 1));
        checkObject(item, 'nested create');
        if (
          Object.hasOwn(item, r.foreign) ||
          Object.entries(target.relations).some(
            ([k, x]) => x.owner && !x.many && x.source === r.foreign && Object.hasOwn(item, k),
          )
        )
          fail('Nested create cannot override parent');
        await this.create(target, { ...item, [r.foreign]: row[r.source] }, depth + 1);
      };
      if (ops.create !== undefined) for (const item of items(ops.create)) await create(item);
      if (ops.connect !== undefined)
        for (const item of items(ops.connect)) await link(await this.locate(target, item));
      if (ops.connectOrCreate !== undefined)
        for (const item of items(ops.connectOrCreate)) {
          const existing = await this.find1(target, item);
          if (existing) await link(existing);
          else await create(item.create);
        }
      if (ops.createMany !== undefined) {
        checkObject(ops.createMany, 'createMany');
        if (
          Object.keys(ops.createMany).some((k) => !['data', 'skipDuplicates'].includes(k)) ||
          !Array.isArray(ops.createMany.data)
        )
          fail('createMany requires data array');
        const data = ops.createMany.data.map((item: any) => {
          checkObject(item, 'createMany data');
          if (Object.hasOwn(item, r.foreign)) fail('Nested create cannot override parent');
          return { ...item, [r.foreign]: row[r.source] };
        });
        await createMany(this, target, { ...ops.createMany, data });
      }
    }
    return row;
  }
  /** Locates the `where` of a `{ where, create }` input, or undefined when it does not exist. */
  async find1(t: Table, input: any): Promise<any> {
    checkObject(input, 'connectOrCreate');
    if (Object.keys(input).some((k) => !['where', 'create'].includes(k)) || !input.create)
      fail('connectOrCreate requires where and create');
    try {
      return await this.locate(t, input.where);
    } catch (error) {
      if (error instanceof OrmError && error.code === 'NOT_FOUND') return undefined;
      throw error;
    }
  }
  async connectOrCreate(t: Table, input: any, depth: number): Promise<any> {
    return (await this.find1(t, input)) ?? this.create(t, input.create, depth + 1);
  }
  async upsert(t: Table, where: any, create: any, update: any): Promise<any> {
    this.unique(t, where);
    checkObject(create, 'create');
    checkObject(update, 'update');
    const referencePolicy = Object.values(t.relations).some(
      (r) => r.owner && !r.many && this.schema.tables[r.target].softDelete,
    );
    if (
      !t.softDelete &&
      !referencePolicy &&
      Object.keys(create).every((k) => !!t.columns[k]) &&
      Object.keys(update).every((k) => !!t.columns[k]) &&
      Object.entries(where).every(([k, v]) => v !== null && v !== undefined && create[k] === v)
    ) {
      const values = { ...create };
      for (const key of Object.keys(values)) {
        if (t.columns[key].auto) fail('Cannot assign generated ' + key);
        if (values[key] === undefined) delete values[key];
      }
      this.defaults(t, values);
      const node = {
        kind: 'upsert' as const,
        table: t,
        data: values,
        update: this.updateValues(t, update),
        conflict: Object.keys(where),
      };
      if (this.adapter.capabilities.returning)
        return this.adapter.dialect.decode(t, (await this.execute(node)).rows[0]);
      // Some dialects react to any unique key on upsert, so the statement is only used when the
      // inserted row can collide on nothing but the key named in where.
      const target = [...node.conflict].sort().join();
      const seen = new Set<string>();
      const collisions = [
        primaryKey(t),
        ...Object.values(t.columns)
          .filter((c) => c.unique)
          .map((c) => [c.name]),
        ...t.unique,
      ].filter((key) => {
        const id = [...key].sort().join();
        if (seen.has(id)) return false;
        seen.add(id);
        return key.every((k) => values[k] !== undefined && values[k] !== null);
      });
      // The row is read back by where, so the update must leave that key unchanged.
      if (
        collisions.length === 1 &&
        [...collisions[0]].sort().join() === target &&
        node.conflict.every((k) => !Object.hasOwn(node.update, k))
      ) {
        await this.execute(node);
        return this.locate(t, where);
      }
    }
    let row;
    try {
      row = await this.locate(t, where);
    } catch (error) {
      if (!(error instanceof OrmError) || error.code !== 'NOT_FOUND') throw error;
    }
    return row ? this.update(t, where, update) : this.create(t, create);
  }
  async update(t: Table, where: any, data: any, depth = 0): Promise<any> {
    if (depth > 8) fail('Maximum write depth is 8');
    checkObject(data, 'data');
    const scalar: any = {};
    const relations: [Relation, any][] = [];
    for (const [name, value] of Object.entries(data)) {
      const relation = t.relations[name];
      if (relation) {
        if (value === undefined) continue;
        if (relation.owner && Object.hasOwn(data, relation.source))
          fail('Cannot update relation and foreign key together');
        relations.push([relation, value]);
      } else scalar[name] = value;
    }
    const values = this.updateValues(t, scalar);
    const old = await this.locate(t, where);
    if (!Object.keys(values).length) {
      for (const [relation, operations] of relations)
        await relationUpdate(this, t, old, relation, operations, depth);
      return relations.length ? this.locate(t, keyOf(t, old)) : old;
    }
    const result = await this.execute({
      kind: 'update',
      table: t,
      where: keyOf(t, old),
      data: values,
    });
    if (this.adapter.capabilities.returning && !result.rows[0])
      throw new OrmError('NOT_FOUND', t.name + ' not found');
    const updated = this.adapter.capabilities.returning
      ? this.adapter.dialect.decode(t, result.rows[0])
      : await this.locate(t, keyOf(t, old));
    await this.checkReferences(t, updated, scalar);
    for (const [relation, operations] of relations)
      await relationUpdate(this, t, old, relation, operations, depth);
    if (relations.length) return this.locate(t, keyOf(t, old));
    return updated;
  }
}
