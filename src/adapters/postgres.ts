import { decodeJson } from '../shared/json.js';
import { validateDateTime } from '../shared/datetime.js';
import { quoteIdentifier as q } from '../query/identifiers.js';
import { OrmError, fail } from '../shared/errors.js';
import {
  encode as encodeScalar,
  safeInteger,
  finiteNumber,
  decodeBigInt,
  decodeDecimal,
  toBytes,
} from '../shared/scalars.js';
import type { Adapter, RuntimeAdapter } from '../core/adapter.js';
import pg from 'pg';
import type { PoolConfig } from 'pg';
import { createHash } from 'node:crypto';
import { columnName, referentialActions, tableName, type Schema, type Table, type Column } from '../schema/index.js';
function encode(c: Column, value: any): any {
  const validated = encodeScalar(c, value);
  if (c.type === 'bytes' && validated !== null) return Buffer.from(validated);
  if (c.type === 'bigint' && validated !== null) return String(validated);
  return c.type === 'boolean' && value !== null ? value : validated;
}
function decode(t: Table, raw: any): any {
  const row: any = {};
  for (const [k, c] of Object.entries(t.columns)) {
    const v = raw[k];
    if (c.type === 'json') {
      row[k] = decodeJson(c.json!, v, c.nullable, k);
      continue;
    }
    if (v === null) {
      row[k] = null;
      continue;
    }
    // pg delivers booleans as JS booleans, and numerics and timestamps as text; strings and enum unions pass through.
    switch (c.type) {
      case 'number': row[k] = finiteNumber(v); break;
      case 'int': row[k] = safeInteger(v); break;
      case 'bigint': row[k] = decodeBigInt(v); break;
      case 'decimal': row[k] = decodeDecimal(c, v); break;
      case 'date': row[k] = validateDateTime(v); break;
      case 'bytes': row[k] = toBytes(v); break;
      default: row[k] = v;
    }
  }
  return row;
}
function groupKey(c: Column, v: any): string {
  return c.type === 'date' ? validateDateTime(v) : String(v);
}
const sqlType = (c: Column) =>
  ({
    int: 'BIGINT',
    bigint: 'BIGINT',
    number: 'DOUBLE PRECISION',
    decimal: c.precision !== undefined ? `NUMERIC(${c.precision},${c.scale})` : 'NUMERIC',
    string: c.maxLength ? `VARCHAR(${c.maxLength})` : 'TEXT',
    boolean: 'BOOLEAN',
    json: 'JSONB',
    date: 'TIMESTAMP(3) WITHOUT TIME ZONE',
    bytes: 'BYTEA',
  })[c.type];
const literal = (v: any) =>
  v === null
    ? 'NULL'
    : typeof v === 'string'
      ? "'" + v.replaceAll("'", "''") + "'"
      : typeof v === 'boolean'
        ? v
          ? 'TRUE'
          : 'FALSE'
        : v;
const name = (...parts: string[]) =>
  'orm_' + createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
export function postgresSchemaSQL(schema: Schema): string[] {
  const tables: string[] = [];
  const constraints: string[] = [];
  const indexes: string[] = [];
  const validateName = (s: string) => {
    if (Buffer.byteLength(s, 'utf8') > 63)
      fail('PostgreSQL identifiers must fit in 63 UTF-8 bytes');
  };
  for (const t of Object.values(schema.tables)) {
    validateName(tableName(t));
    const col = (key: string) => q(columnName(t.columns[key]));
    const defs = Object.values(t.columns).map((c) => {
      validateName(columnName(c));
      const name = q(columnName(c));
      let sql = `${name} ${sqlType(c)}${c.auto ? ' GENERATED ALWAYS AS IDENTITY' : ''}${c.nullable ? '' : ' NOT NULL'}${c.primary ? ' PRIMARY KEY' : ''}${c.unique ? ' UNIQUE' : ''}`;
      if (c.default !== undefined) {
        const d = c.default;
        if (d && typeof d === 'object') {
          if (d.fn === 'now') sql += ' DEFAULT CURRENT_TIMESTAMP';
        } else {
          encode(c, d);
          sql += ' DEFAULT ' + literal(d);
        }
      }
      if (c.enum) sql += ` CHECK (${name} IN (${c.enum.map(literal).join(',')}))`;
      return sql;
    });
    if (t.primaryKey?.length) defs.push(`PRIMARY KEY (${t.primaryKey.map(col).join(',')})`);
    for (const keys of t.unique) defs.push(`UNIQUE (${keys.map(col).join(',')})`);
    tables.push(`CREATE TABLE ${q(tableName(t))} (${defs.join(', ')})`);
    for (const keys of t.indexes)
      indexes.push(
        `CREATE INDEX ${q(name(t.name, ...keys))} ON ${q(tableName(t))} (${keys.map(col).join(',')})`,
      );
    for (const r of Object.values(t.relations))
      if (r.owner && !r.many) {
        const target = schema.tables[r.target];
        constraints.push(
          `ALTER TABLE ${q(tableName(t))} ADD CONSTRAINT ${q(name(t.name, r.name, 'fk'))} FOREIGN KEY (${col(r.source)}) REFERENCES ${q(tableName(target))} (${q(columnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? 'Restrict']} ON UPDATE ${referentialActions[r.onUpdate ?? 'Restrict']}`,
        );
        if (!t.columns[r.source].unique)
          indexes.push(
            `CREATE INDEX ${q(name(t.name, r.name, 'fkidx'))} ON ${q(tableName(t))} (${col(r.source)})`,
          );
      }
  }
  for (const t of Object.values(schema.tables))
    for (const r of Object.values(t.relations))
      if (r.owner && r.junction) {
        validateName(r.junction);
        const target = schema.tables[r.target];
        const source = t.columns[r.source];
        const foreign = target.columns[r.foreign];
        tables.push(
          `CREATE TABLE ${q(r.junction)} (${q('sourceId')} ${sqlType(source)} NOT NULL, ${q('targetId')} ${sqlType(foreign)} NOT NULL, PRIMARY KEY (${q('sourceId')},${q('targetId')}))`,
        );
        constraints.push(
          `ALTER TABLE ${q(r.junction)} ADD FOREIGN KEY (${q('sourceId')}) REFERENCES ${q(tableName(t))} (${q(columnName(source))}) ON DELETE CASCADE, ADD FOREIGN KEY (${q('targetId')}) REFERENCES ${q(tableName(target))} (${q(columnName(foreign))}) ON DELETE CASCADE`,
        );
        indexes.push(
          `CREATE INDEX ${q(name(r.junction, 'reverse'))} ON ${q(r.junction)} (${q('targetId')})`,
        );
      }
  return [...tables, ...constraints, ...indexes];
}

export interface PostgresConnection {
  query(
    text: string | { text: string; values?: any[]; types: pg.CustomTypesConfig; binary?: boolean },
    values?: any[],
  ): Promise<{
    rows: any[];
    rowCount: number | null;
  }>;
  release(error?: Error | boolean): void;
  processID?: number | null;
}
export interface PostgresOptions {
  /** pg pool settings; keep pg's default bigint parser so the adapter can range-check integers. */
  connection: PoolConfig;
  /** Existing PostgreSQL schema, defaults to public. */
  dbSchema?: string;
  /** Transactional initialization of an empty schema. */
  initialize?: boolean;
}
function translate(error: any): Error {
  if (error instanceof OrmError) return error;
  if (error instanceof Error && !Object.hasOwn(error, 'code')) return error;
  const codes: Record<string, string> = {
    '23505': 'UNIQUE_CONSTRAINT',
    '23503': 'FOREIGN_KEY_CONSTRAINT',
    '23502': 'NOT_NULL_CONSTRAINT',
    '23514': 'CHECK_CONSTRAINT',
    '40001': 'SERIALIZATION_FAILURE',
    '40P01': 'TRANSACTION_DEADLOCK',
    '55P03': 'LOCK_TIMEOUT',
    '57014': 'QUERY_CANCELLED',
    '25P02': 'TRANSACTION_ABORTED',
  };
  return new OrmError(
    codes[error?.code] ?? 'DATABASE_ERROR',
    `PostgreSQL operation failed (${error?.code ?? 'unknown'})`,
    { cause: error },
  );
}
async function connectPostgres(schema: Schema, options: PostgresOptions): Promise<RuntimeAdapter> {
  if (!options?.connection) fail('Provide PostgreSQL connection options');
  const namespace = options.dbSchema ?? 'public';
  if (
    !namespace ||
    namespace.startsWith('pg_') ||
    namespace === 'information_schema' ||
    namespace.includes('\0') ||
    Buffer.byteLength(namespace) > 63
  )
    fail('Invalid PostgreSQL schema name');
  const ddl = postgresSchemaSQL(schema);
  const created = new pg.Pool(options.connection);
  // pg reports idle connection failures on the pool; without a listener they surface as
  // unhandled errors and terminate the process.
  created.on('error', () => {});
  const pool: { connect(): Promise<PostgresConnection>; end(): Promise<void> } = created;
  async function acquire() {
    const c = await pool.connect();
    try {
      await c.query("SELECT set_config('search_path', $1, false)", [q(namespace) + ', pg_catalog']);
      await c.query("SET TIME ZONE 'UTC'");
      await c.query('SET standard_conforming_strings = on');
      return c;
    } catch (error) {
      c.release(true);
      throw error;
    }
  }
  try {
    const c = await acquire();
    let begun = false;
    let broken = false;
    try {
      const version = await c.query("SELECT current_setting('server_version_num') AS version");
      if (
        Number(version.rows[0]?.version) < 140000 ||
        !Number.isFinite(Number(version.rows[0]?.version))
      )
        throw new OrmError('UNSUPPORTED_SERVER', 'Requires PostgreSQL 14+');
      const found = await c.query('SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1', [
        namespace,
      ]);
      if (!found.rows.length)
        throw new OrmError('SCHEMA_NOT_FOUND', 'Create the PostgreSQL schema before connecting');
      if (options.initialize) {
        await c.query('BEGIN');
        begun = true;
        await c.query('SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext($1))', [
          namespace,
        ]);
        const existing = await c.query(
          "SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S','f')",
          [namespace],
        );
        if (existing.rows.length)
          throw new OrmError(
            'DATABASE_NOT_EMPTY',
            'initialize requires an empty PostgreSQL schema',
          );
        for (const sql of ddl) {
          await c.query(sql);
        }
        await c.query('COMMIT');
        begun = false;
      }
    } catch (error) {
      if (begun) {
        try {
          await c.query('ROLLBACK');
        } catch {
          broken = true;
        }
      }
      throw error;
    } finally {
      c.release(broken);
    }
  } catch (error) {
    await pool.end();
    throw translate(error);
  }
  return {
    dialect: {
      name: 'postgres',
      quote: q,
      parameter: (i) => '$' + i,
      encode,
      decode,
      groupKey,
      unlimited: null,
      trueLiteral: 'TRUE',
      falseLiteral: 'FALSE',
      emptyInsertValues: 'DEFAULT VALUES',
      onConflictDoNothing: () => ' ON CONFLICT DO NOTHING',
      upsertConflictSuffix: (cols) => ') ON CONFLICT (' + cols + ') DO UPDATE SET ',
      deleteKeyword: () => '',
      pageValue: (value) => value,
      bigintOperand: (value) => String(value),
      wrapDecimalOperand: (operand) => operand,
      integerDivide: (expr) => expr,
      containsPredicate: (col, placeholder, insensitive) =>
        insensitive ? `${col} ILIKE ${placeholder} ESCAPE '!'` : `${col} LIKE ${placeholder} ESCAPE '!'`,
      nullsOrder: (first) => `NULLS ${first ? 'FIRST' : 'LAST'}`,
      booleanMinMax: (op, expr) => (op === 'MIN' ? 'BOOL_AND(' : 'BOOL_OR(') + expr + ')',
      defaultTransactionIsolation: (readOnly) => (readOnly ? 'repeatable read' : 'read committed'),
      json: {
        predicate: (col, path, value, params, ctx) => {
          const pathParam = () => ctx.bind(params, path.map(String)) + '::text[]';
          const type = () => `jsonb_typeof(${col} #> ${pathParam()})`;
          const text = () => `${col} #>> ${pathParam()}`;
          const number = () => `(${text()})::numeric`;
          const types: Record<'string' | 'number', string> = {
            string: "'string'",
            number: "'number'",
          };
          const guard = (kind: 'string' | 'number', condition: () => string) =>
            `COALESCE(${type()} IN (${types[kind]}) AND ${condition()}, ${ctx.falsity})`;
          const equals = (v: unknown): string => {
            if (v !== null && !['string', 'number', 'boolean'].includes(typeof v))
              fail('JSON equals accepts a string, number, boolean or null');
            if (typeof v === 'number' && !Number.isFinite(v))
              fail('JSON equals requires a finite number');
            return `COALESCE(${col} #> ${pathParam()} = ${ctx.bind(params, JSON.stringify(v))}::jsonb, ${ctx.falsity})`;
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
      isolationLevels: ['read committed', 'repeatable read', 'serializable'],
    },
    translate,
    async acquire() {
      const c = await acquire();
      return {
        async execute({ text, values }) {
          const result = await c.query({
            text,
            values,
            binary: false,
            types: {
              getTypeParser: (oid: number, format?: string) =>
                [1114, 114, 3802].includes(oid)
                  ? (value: string) => value
                  : pg.types.getTypeParser(oid, format as 'text'),
            },
          });
          return { rows: result.rows, affectedRows: result.rowCount ?? 0 };
        },
        async begin(options) {
          await c.query(
            options?.isolationLevel
              ? 'BEGIN ISOLATION LEVEL ' +
                  options.isolationLevel.toUpperCase() +
                  (options.readOnly ? ' READ ONLY' : '')
              : 'BEGIN',
          );
        },
        async commit() {
          await c.query('COMMIT');
        },
        async rollback() {
          await c.query('ROLLBACK');
        },
        release: (broken) => c.release(broken),
        async cancel() {
          if (!c.processID) return;
          const admin = new pg.Client(options.connection);
          admin.on('error', () => {});
          try {
            await admin.connect();
            await admin.query('SELECT pg_cancel_backend($1)', [c.processID]);
          } finally {
            await admin.end().catch(() => {});
          }
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
}
export function postgres(options: PostgresOptions): Adapter {
  return { name: 'postgres', connect: (schema) => connectPostgres(schema, options) };
}
