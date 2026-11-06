import { visibleWhere } from '../query/visibility.js';
import type { Engine } from './engine.js';
import type { Table, Column } from '../schema/index.js';
import { fail } from '../shared/errors.js';
import { checkObject, object } from '../shared/validation.js';
import { safeInteger, finiteNumber, decodeBigInt, decodeDecimal } from '../shared/scalars.js';

const operations = ['_count', '_sum', '_avg', '_min', '_max'] as const;
type Operation = (typeof operations)[number];
export async function analytics(
  engine: Engine,
  table: Table,
  args: any = {},
  grouped = false,
): Promise<any> {
  checkObject(args, 'aggregate');
  const allowed = [
    'where',
    'deleted',
    'orderBy',
    'skip',
    'take',
    ...operations,
    ...(grouped ? ['by', 'having'] : []),
  ];
  for (const key of Object.keys(args))
    if (!allowed.includes(key)) fail('Unknown aggregate option ' + key);
  const by: string[] = grouped ? (Array.isArray(args.by) ? args.by : []) : [];
  if (
    grouped &&
    (!by.length ||
      new Set(by).size !== by.length ||
      by.some((k) => !table.columns[k] || table.columns[k].type === 'json'))
  )
    fail('by requires distinct scalar fields');
  const q = engine.quote;
  const d = engine.adapter.dialect;
  const values: any[] = [];
  const selected: { op: Operation; field: string; alias: string; column?: Column }[] = [];
  // Grouped queries read the table itself; aggregates read an aliased subquery.
  const column = (field: string) =>
    grouped ? engine.column(table, 't', field) : q('t') + '.' + q(field);
  const aggregate = (op: Operation, field: string) => {
    if (field === '_all') {
      if (op !== '_count') fail('_all only supports count');
      return 'COUNT(*)';
    }
    const c = table.columns[field];
    if (!c) fail('Unknown aggregate field ' + field);
    if (c.type === 'json') fail('JSON aggregation is not supported');
    if ((op === '_avg' || op === '_sum') && !['int', 'bigint', 'number', 'decimal'].includes(c.type))
      fail(op + ' requires numeric field');
    // Boolean min/max has no plain aggregate in some dialects; the dialect provides the equivalent.
    if (c.type === 'boolean' && (op === '_min' || op === '_max'))
      return d.booleanMinMax(op === '_min' ? 'MIN' : 'MAX', column(field));
    return op.slice(1).toUpperCase() + '(' + column(field) + ')';
  };
  const select = by.map((field) => column(field) + ' AS ' + q(field));
  for (const op of operations) {
    const input = args[op];
    if (input === undefined || input === false) continue;
    if (input === true && op === '_count') {
      selected.push({ op, field: '_all', alias: '__orm_count_all' });
      select.push('COUNT(*) AS ' + q('__orm_count_all'));
      continue;
    }
    checkObject(input, op);
    for (const [field, enabled] of Object.entries(input)) {
      if (typeof enabled !== 'boolean') fail('Aggregate selection requires boolean');
      if (!enabled) continue;
      const expression = aggregate(op, field);
      const alias = '__orm' + op + '_' + field;
      selected.push({ op, field, alias, column: table.columns[field] });
      select.push(expression + ' AS ' + q(alias));
    }
  }
  if (!select.length) fail('Select at least one aggregate');
  let text: string;
  if (!grouped) {
    const source = engine.compile({
      kind: 'select',
      table,
      args: {
        select: Object.fromEntries(
          selected.filter((item) => item.field !== '_all').map((item) => [item.field, true]),
        ),
        where: visibleWhere(args.where, args.deleted),
        orderBy: args.orderBy,
        skip: args.skip,
        take: args.take,
      },
    });
    engine.validate(table, {
      where: visibleWhere(args.where, args.deleted),
      orderBy: args.orderBy,
      skip: args.skip,
      take: args.take,
    });
    // Expressions carry no parameters; reuse the structurally compiled source values.
    values.push(...source.values);
    text = 'SELECT ' + select.join(',') + ' FROM (' + source.text + ') AS ' + q('t');
  } else {
    const having = (input: any, depth = 0): string => {
      if (input === undefined) return engine.truth;
      if (depth > 12) fail('Maximum having depth is 12');
      checkObject(input, 'having');
      const pieces: string[] = [];
      for (const [field, value] of Object.entries(input)) {
        if (field === 'AND' || field === 'OR') {
          if (!Array.isArray(value)) fail(field + ' requires array');
          pieces.push(
            (value as any[]).length
              ? '(' +
                  (value as any[]).map((v: any) => having(v, depth + 1)).join(' ' + field + ' ') +
                  ')'
              : field === 'AND'
                ? engine.truth
                : engine.falsity,
          );
          continue;
        }
        if (field === 'NOT') {
          pieces.push('NOT (' + having(value, depth + 1) + ')');
          continue;
        }
        const c = table.columns[field];
        if (!c) fail('Unknown having field ' + field);
        if (object(value)) {
          const scalars: any = {};
          for (const [key, filter] of Object.entries(value as object)) {
            if (operations.includes(key as Operation)) {
              const op = key as Operation;
              const expression = aggregate(op, field);
              const operand: Column =
                op === '_count'
                  ? { ...c, type: 'int', nullable: false }
                  : op === '_avg'
                    ? { ...c, type: 'number' }
                    : c;
              pieces.push(engine.scalar(operand, expression, filter, values));
            } else scalars[key] = filter;
          }
          if (Object.keys(scalars).length) {
            if (!by.includes(field)) fail('Plain having field must appear in by');
            pieces.push(engine.scalar(c, column(field), scalars, values));
          }
        } else {
          if (!by.includes(field)) fail('Plain having field must appear in by');
          pieces.push(engine.scalar(c, column(field), value, values));
        }
      }
      return pieces.length ? pieces.map((p) => '(' + p + ')').join(' AND ') : engine.truth;
    };
    const where = engine.predicate(table, visibleWhere(args.where, args.deleted), 't', values);
    text =
      'SELECT ' +
      select.join(',') +
      ' FROM ' +
      engine.table(table) +
      ' ' +
      q('t') +
      ' WHERE ' +
      where +
      ' GROUP BY ' +
      by.map(column).join(',');
    if (args.having !== undefined) text += ' HAVING ' + having(args.having);
    const orders: string[] = [];
    for (const item of args.orderBy === undefined
      ? []
      : Array.isArray(args.orderBy)
        ? args.orderBy
        : [args.orderBy]) {
      checkObject(item, 'orderBy');
      for (const [key, value] of Object.entries(item)) {
        if (operations.includes(key as Operation)) {
          checkObject(value, 'aggregate orderBy');
          for (const [field, direction] of Object.entries(value as object)) {
            if (!['asc', 'desc'].includes(direction as string)) fail('Invalid aggregate order');
            const nulls = d.nullsOrder(direction === 'asc');
            orders.push(
              aggregate(key as Operation, field) +
                ' ' +
                direction +
                (nulls ? ' ' + nulls : ''),
            );
          }
        } else {
          if (!by.includes(key) || !['asc', 'desc'].includes(value as string))
            fail('Group order field must appear in by');
          const nulls = d.nullsOrder(value === 'asc');
          orders.push(column(key) + ' ' + value + (nulls ? ' ' + nulls : ''));
        }
      }
    }
    if ((args.take !== undefined || args.skip !== undefined) && !orders.length)
      fail('Grouped pagination requires orderBy');
    for (const key of ['skip', 'take'])
      if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 0))
        fail(key + ' requires nonnegative integer');
    const defaultNull = d.nullsOrder(true);
    const defaultNulls = defaultNull ? ' ' + defaultNull : '';
    text +=
      ' ORDER BY ' +
      (orders.length
        ? orders
        : by.map((field) => column(field) + ' ASC' + defaultNulls)
      ).join(',') +
      ' LIMIT ' +
      engine.bindPage(values, args.take ?? d.unlimited) +
      ' OFFSET ' +
      engine.bindPage(values, args.skip ?? 0);
  }
  const result = await engine.session.execute({ text, values });
  const decode = (raw: any) => {
    const output: any = by.length
      ? d.decode(
          { ...table, columns: Object.fromEntries(by.map((k) => [k, table.columns[k]])) },
          raw,
        )
      : {};
    for (const item of selected) {
      const value = raw[item.alias];
      let decoded: any = value;
      if (value !== null) {
        if (item.op === '_count') decoded = safeInteger(value);
        else if (item.op === '_avg' || item.op === '_sum') {
          const type = item.column!.type;
          decoded =
            type === 'decimal'
              ? decodeDecimal(item.op === '_sum' ? item.column! : { ...item.column!, scale: undefined }, value)
              : item.op === '_sum' && type === 'int'
                ? safeInteger(value)
                : item.op === '_sum' && type === 'bigint'
                  ? decodeBigInt(typeof value === 'string' ? value.replace(/\.0+$/, '') : value)
                  : finiteNumber(value);
        }
        else
          decoded = d.decode(
            { ...table, columns: { [item.field]: item.column! } },
            { [item.field]: value },
          )[item.field];
      }
      if (args[item.op] === true) output[item.op] = decoded;
      else {
        output[item.op] ??= {};
        output[item.op][item.field] = decoded;
      }
    }
    return output;
  };
  return grouped ? result.rows.map(decode) : decode(result.rows[0]);
}
