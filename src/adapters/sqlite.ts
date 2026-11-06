import { validateDateTime } from '../shared/datetime.js';
import { OrmError, fail } from '../shared/errors.js';
import { encode as encodeScalar, decode, safeInteger } from '../shared/scalars.js';
import { quoteIdentifier as q } from '../query/identifiers.js';
import type { Adapter, RuntimeAdapter } from '../core/adapter.js';
import { DatabaseSync } from 'node:sqlite';
import { columnName, referentialActions, tableName, type Column, type Schema } from '../schema/index.js';
const sqliteType = (c: Column) =>
  ['int', 'bigint', 'boolean'].includes(c.type)
    ? 'INTEGER'
    : c.type === 'number'
      ? 'REAL'
      : c.type === 'decimal'
        ? 'NUMERIC'
        : c.type === 'bytes'
          ? 'BLOB'
          : 'TEXT';
export function sqliteSchemaSQL(schema: Schema): string[] {
  const statements: string[] = [];
  for (const t of Object.values(schema.tables)) {
    const col = (key: string) => q(columnName(t.columns[key]));
    const definitions = Object.values(t.columns).map((c) => {
      const name = q(columnName(c));
      let sql = `${name} ${sqliteType(c)}`;
      if (c.primary) sql += ' PRIMARY KEY';
      if (c.auto) sql += ' AUTOINCREMENT';
      if (!c.nullable) sql += ' NOT NULL';
      if (c.unique) sql += ' UNIQUE';
      if (c.maxLength) sql += ` CHECK (length(${name}) <= ${c.maxLength})`;
      if (c.type === 'json') sql += ' CHECK (json_valid(' + name + '))';
      if (c.enum)
        sql += ` CHECK (${name} IN (${c.enum.map((v) => "'" + v.replaceAll("'", "''") + "'").join(',')}))`;
      if (c.type === 'boolean') sql += ` CHECK (${name} IN (0,1))`;
      if (c.default !== undefined) {
        const d = c.default;
        if (d && typeof d === 'object') {
          if (d.fn === 'now') sql += " DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now','localtime'))";
        } else
          sql +=
            ' DEFAULT ' +
            (d === null
              ? 'NULL'
              : typeof d === 'string'
                ? "'" + d.replaceAll("'", "''") + "'"
                : typeof d === 'boolean'
                  ? Number(d)
                  : d);
      }
      return sql;
    });
    if (t.primaryKey?.length) definitions.push(`PRIMARY KEY (${t.primaryKey.map(col).join(',')})`);
    for (const r of Object.values(t.relations))
      if (r.owner && !r.many) {
        const target = schema.tables[r.target];
        definitions.push(
          `FOREIGN KEY (${col(r.source)}) REFERENCES ${q(tableName(target))} (${q(columnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? 'Restrict']}${r.onUpdate ? ' ON UPDATE ' + referentialActions[r.onUpdate] : ''}`,
        );
      }
    for (const keys of t.unique) definitions.push(`UNIQUE (${keys.map(col).join(',')})`);
    statements.push(`CREATE TABLE ${q(tableName(t))} (${definitions.join(', ')});`);
    for (const keys of t.indexes)
      statements.push(
        `CREATE INDEX ${q(`${t.name}_${keys.join('_')}_idx`)} ON ${q(tableName(t))} (${keys.map(col).join(',')});`,
      );
    for (const r of Object.values(t.relations))
      if (r.owner && !r.many && !t.columns[r.source].unique)
        statements.push(
          `CREATE INDEX ${q(`${t.name}_${r.source}_fk_idx`)} ON ${q(tableName(t))} (${col(r.source)});`,
        );
  }
  for (const t of Object.values(schema.tables))
    for (const r of Object.values(t.relations))
      if (r.owner && r.junction) {
        const target = schema.tables[r.target];
        const source = t.columns[r.source];
        const foreign = target.columns[r.foreign];
        statements.push(
          `CREATE TABLE ${q(r.junction)} ("sourceId" ${sqliteType(source)} NOT NULL REFERENCES ${q(tableName(t))} (${q(columnName(source))}) ON DELETE CASCADE, "targetId" ${sqliteType(foreign)} NOT NULL REFERENCES ${q(tableName(target))} (${q(columnName(foreign))}) ON DELETE CASCADE, PRIMARY KEY ("sourceId", "targetId"));`,
        );
        statements.push(
          `CREATE INDEX ${q(r.junction + '_reverse_idx')} ON ${q(r.junction)} ("targetId");`,
        );
      }
  return statements;
}

export interface SQLiteOptions {
  filename?: string;
  initialize?: boolean;
}
export function sqlite(options: SQLiteOptions = {}): Adapter {
  return { name: 'sqlite', connect: (schema) => connectSQLite(schema, options) };
}
function connectSQLite(schema: Schema, options: SQLiteOptions): RuntimeAdapter {
  const db = new DatabaseSync(options.filename ?? ':memory:');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (options.initialize) {
    try {
      db.exec('BEGIN');
      for (const sql of sqliteSchemaSQL(schema)) db.exec(sql);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      db.close();
      throw e;
    }
  }
  let tail = Promise.resolve();
  let broken = false;
  return {
    dialect: {
      name: 'sqlite',
      quote: q,
      parameter: () => '?',
      encode: encodeScalar,
      decode: (table, row) =>
        decode(
          table,
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [
              k,
              typeof v === 'bigint' && table.columns[k]?.type !== 'bigint' && table.columns[k]?.type !== 'decimal'
                ? safeInteger(v)
                : v,
            ]),
          ),
        ),
      groupKey: (c, v) => (c.type === 'date' ? validateDateTime(v) : String(v)),
      unlimited: -1,
      trueLiteral: '1',
      falseLiteral: '0',
      emptyInsertValues: 'DEFAULT VALUES',
      onConflictDoNothing: () => ' ON CONFLICT DO NOTHING',
      upsertConflictSuffix: (cols) => ') ON CONFLICT (' + cols + ') DO UPDATE SET ',
      deleteKeyword: () => '',
      pageValue: (value) => value,
      bigintOperand: (value) => value,
      wrapDecimalOperand: (operand) => operand,
      integerDivide: (expr) => 'CAST(' + expr + ' AS INTEGER)',
      containsPredicate: (col, placeholder, insensitive) =>
        insensitive
          ? `LOWER(${col}) LIKE LOWER(${placeholder}) ESCAPE '!'`
          : `${col} LIKE ${placeholder} ESCAPE '!'`,
      nullsOrder: () => undefined,
      booleanMinMax: (op, expr) => op + '(' + expr + ')',
      defaultTransactionIsolation: () => 'serializable',
      json: {
        predicate: (col, path, value, params, ctx) => {
          const pathParam = () =>
            ctx.bind(
              params,
              '$' +
                path
                  .map((p) => (typeof p === 'number' ? `[${p}]` : '.' + JSON.stringify(p)))
                  .join(''),
            );
          const type = () => `json_type(${col}, ${pathParam()})`;
          const text = () => `json_extract(${col}, ${pathParam()})`;
          const number = () => `json_extract(${col}, ${pathParam()})`;
          const types: Record<'string' | 'number', string> = {
            string: "'text'",
            number: "'integer','real'",
          };
          const guard = (kind: 'string' | 'number', condition: () => string) =>
            `COALESCE(${type()} IN (${types[kind]}) AND ${condition()}, ${ctx.falsity})`;
          const equals = (v: unknown): string => {
            if (v !== null && !['string', 'number', 'boolean'].includes(typeof v))
              fail('JSON equals accepts a string, number, boolean or null');
            if (typeof v === 'number' && !Number.isFinite(v))
              fail('JSON equals requires a finite number');
            if (v === null) return `COALESCE(${type()} = 'null', 0)`;
            if (typeof v === 'boolean') return `COALESCE(${type()} = '${v}', 0)`;
            return guard(
              typeof v === 'string' ? 'string' : 'number',
              () => `${text()} = ${ctx.bind(params, v)}`,
            );
          };
          const pieces: string[] = [];
          for (const [op, v] of Object.entries(value)) {
            if (op === 'path') continue;
            if (op === 'equals') pieces.push(equals(v));
            else if (op === 'not') pieces.push(`NOT (${equals(v)})`);
            else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
              if (typeof v !== 'number' || !Number.isFinite(v))
                fail(`JSON ${op} requires a finite number`);
              pieces.push(
                guard(
                  'number',
                  () =>
                    `${number()} ${{ gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${ctx.bind(params, v)}`,
                ),
              );
            } else {
              if (typeof v !== 'string') fail(`JSON ${op} requires a string`);
              pieces.push(
                guard(
                  'string',
                  () =>
                    `${text()} LIKE ${ctx.bind(params, ctx.pattern(op, v as string))} ESCAPE '!'`,
                ),
              );
            }
          }
          return pieces.length ? pieces.map((x) => '(' + x + ')').join(' AND ') : ctx.truth;
        },
      },
    },
    capabilities: {
      returning: true,
      windowFunctions: true,
      transactionalDDL: true,
      versionedMigrations: true,
      isolationLevels: ['serializable'],
    },
    async acquire() {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>((resolve) => (unlock = resolve));
      await previous;
      if (broken) {
        unlock();
        throw new OrmError('CLIENT_CLOSED', 'SQLite connection is unusable');
      }
      return {
        async execute({ text, values }) {
          const statement = db.prepare(text);
          statement.setReadBigInts(true);
          if (statement.columns().length) {
            const rows = statement.all(...values);
            return { rows, affectedRows: rows.length };
          }
          const result = statement.run(...values);
          return {
            rows: [],
            affectedRows: Number(result.changes),
            insertId: result.lastInsertRowid,
          };
        },
        async begin(options) {
          db.exec(options?.readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
        },
        async commit() {
          db.exec('COMMIT');
        },
        async rollback() {
          db.exec('ROLLBACK');
        },
        release(failed) {
          if (failed) broken = true;
          unlock();
        },
      };
    },
    async close() {
      db.close();
    },
    translate(error) {
      if (error instanceof OrmError || !error?.code) return error;
      const message = String(error.message);
      const code = message.includes('UNIQUE constraint')
        ? 'UNIQUE_CONSTRAINT'
        : message.includes('FOREIGN KEY constraint')
          ? 'FOREIGN_KEY_CONSTRAINT'
          : message.includes('NOT NULL constraint')
            ? 'NOT_NULL_CONSTRAINT'
            : message.includes('CHECK constraint')
              ? 'CHECK_CONSTRAINT'
              : 'DATABASE_ERROR';
      return new OrmError(code, 'SQLite operation failed', { cause: error });
    },
  };
}
