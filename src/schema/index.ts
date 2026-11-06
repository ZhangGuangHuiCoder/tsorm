import type { JsonShape, JsonDefinition } from '../shared/json.js';
export class SchemaError extends Error {
  constructor(
    message: string,
    public line = 0,
    public column = 0,
  ) {
    super(`${line}:${column} ${message}`);
    this.name = 'SchemaError';
  }
}
export type Scalar = 'int' | 'bigint' | 'number' | 'decimal' | 'string' | 'boolean' | 'date' | 'json' | 'bytes';
export type ReferentialAction = 'Cascade' | 'Restrict' | 'NoAction' | 'SetNull';
/** SQL spelling of each referential action, shared by every dialect. */
export const referentialActions: Record<ReferentialAction, string> = {
  Cascade: 'CASCADE',
  Restrict: 'RESTRICT',
  NoAction: 'NO ACTION',
  SetNull: 'SET NULL',
};
export interface Column {
  json?: JsonDefinition;
  name: string;
  type: Scalar;
  nullable: boolean;
  primary: boolean;
  auto: boolean;
  unique: boolean;
  default?:
    | string
    | number
    | boolean
    | null
    | {
        fn: 'now' | 'uuid';
      };
  maxLength?: number;
  /** decimal(precision, scale) */
  precision?: number;
  scale?: number;
  enum?: string[];
  /** Set to the current time on create and on every update (@updatedAt). */
  updatedAt?: boolean;
  /** Physical column name (@map). */
  map?: string;
}
export interface Relation {
  name: string;
  target: string;
  many: boolean;
  nullable: boolean;
  owner: boolean;
  source: string;
  foreign: string;
  junction?: string;
  junctionSource?: string;
  junctionTarget?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}
export interface Table {
  virtuals?: Record<string, { needs: string[]; compute: (row: any) => unknown }>;
  softDelete?: string;
  name: string;
  columns: Record<string, Column>;
  relations: Record<string, Relation>;
  /** Single-column primary key; '' when the model uses a composite @@id. */
  primary: string;
  /** Composite primary key columns (@@id). */
  primaryKey?: string[];
  /** Physical table name (@@map). */
  map?: string;
  unique: string[][];
  indexes: string[][];
  /** Client-wide omit defaults from createClient({ omit }). */
  omit?: Record<string, boolean>;
}
/** Primary key columns of a model, single or composite. */
export const primaryKey = (t: Table): string[] => (t.primaryKey?.length ? t.primaryKey : [t.primary]);
/** Fields hidden from a result: the client-wide omit overridden by the query's own. */
export const omitted = (t: Table, args: any): Record<string, boolean> | undefined =>
  args.select ? undefined : t.omit ? { ...t.omit, ...args.omit } : args.omit;
/** Physical table name. */
export const tableName = (t: Table): string => t.map ?? t.name;
/** Physical column name. */
export const columnName = (c: Column): string => c.map ?? c.name;
export interface Schema {
  jsonTypes?: Record<string, JsonShape>;
  version: 1;
  tables: Record<string, Table>;
}
type Token = {
  value: string;
  kind: 'id' | 'string' | 'number' | 'symbol';
  line: number;
  column: number;
};
function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let column = 1;
  const advance = (s: string) => {
    for (const c of s) {
      if (c === '\n') {
        line++;
        column = 1;
      } else column++;
    }
    i += s.length;
  };
  while (i < input.length) {
    const rest = input.slice(i);
    const ignored = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (ignored) {
      advance(ignored[0]);
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = /^"(?:\\.|[^"\\])*"/.exec(rest))) {
      const raw = match[0];
      let value: string;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new SchemaError('Invalid string', line, column);
      }
      tokens.push({ value, kind: 'string', line, column });
      advance(raw);
    } else if ((match = /^-?\d+(?:\.\d+)?/.exec(rest))) {
      tokens.push({ value: match[0], kind: 'number', line, column });
      advance(match[0]);
    } else if ((match = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      tokens.push({ value: match[0], kind: 'id', line, column });
      advance(match[0]);
    } else if ('{}[]():;,@?=|.<>'.includes(rest[0])) {
      tokens.push({ value: rest[0], kind: 'symbol', line, column });
      advance(rest[0]);
    } else throw new SchemaError(`Unexpected character ${rest[0]}`, line, column);
  }
  tokens.push({ value: '<EOF>', kind: 'symbol', line, column });
  return tokens;
}
type Attribute = {
  name: string;
  args: any[];
  options: Record<string, any>;
};
type Field = {
  json?: JsonShape;
  name: string;
  type: string;
  nullable: boolean;
  many: boolean;
  attrs: Attribute[];
  token: Token;
  default?: Column['default'];
  maxLength?: number;
  precision?: number;
  scale?: number;
  enum?: string[];
};
type Model = {
  name: string;
  fields: Field[];
  attrs: Attribute[];
};
export function parseSchema(input: string): Schema {
  const tokens = lex(input);
  let p = 0;
  const peek = () => tokens[p];
  const error = (message: string, token = peek()): never => {
    throw new SchemaError(message, token.line, token.column);
  };
  const eat = (s: string) => {
    if (peek().value === s) {
      p++;
      return true;
    }
    return false;
  };
  const expect = (s: string) => {
    if (!eat(s)) error(`Expected ${s}, got ${peek().value}`);
  };
  const ident = () => {
    const t = peek();
    if (t.kind !== 'id') error('Expected identifier');
    p++;
    return t.value;
  };
  const value = (): any => {
    if (eat('[')) {
      const result = [];
      while (!eat(']')) {
        result.push(value());
        if (!eat(',')) {
          expect(']');
          break;
        }
      }
      return result;
    }
    const t = tokens[p++];
    if (!t) error('Unexpected end');
    if (t.kind === 'string') return t.value;
    if (t.kind === 'number') return Number(t.value);
    if (t.kind !== 'id') error('Expected value', t);
    if (t.value === 'true') return true;
    if (t.value === 'false') return false;
    if (t.value === 'null') return null;
    if (eat('(')) {
      expect(')');
      if (!['now', 'uuid'].includes(t.value)) error('Unknown default function', t);
      return { fn: t.value };
    }
    return t.value;
  };
  const attribute = (): Attribute => {
    const name = ident();
    const args: any[] = [];
    const options: Record<string, any> = Object.create(null);
    if (eat('('))
      while (!eat(')')) {
        if (peek().kind === 'id' && tokens[p + 1].value === ':') {
          const key = ident();
          expect(':');
          if (key in options) error(`Duplicate option ${key}`);
          options[key] = value();
        } else args.push(value());
        if (!eat(',')) {
          expect(')');
          break;
        }
      }
    return { name, args, options };
  };
  const jsonTypes: Record<string, JsonShape> = Object.create(null);
  const jsonShape = (): JsonShape => {
    const atom = (): JsonShape => {
      let shape: JsonShape;
      if (eat('{')) {
        const fields: Record<string, { optional: boolean; shape: JsonShape }> = Object.create(null);
        while (!eat('}')) {
          const name = ident();
          const optional = eat('?');
          expect(':');
          if (Object.hasOwn(fields, name)) error('Duplicate JSON field ' + name);
          fields[name] = { optional, shape: jsonShape() };
          eat(';');
          eat(',');
        }
        shape = { kind: 'object', fields };
      } else {
        const token = peek();
        if (token.kind === 'string' || token.kind === 'number') {
          p++;
          shape = {
            kind: 'literal',
            value: token.kind === 'number' ? Number(token.value) : token.value,
          };
        } else {
          const name = ident();
          if (name === 'Record') {
            expect('<');
            expect('string');
            expect(',');
            const value = jsonShape();
            expect('>');
            shape = { kind: 'record', value };
          } else if (['string', 'number', 'boolean', 'null'].includes(name))
            shape = { kind: 'primitive', name: name as 'string' };
          else if (name === 'true' || name === 'false')
            shape = { kind: 'literal', value: name === 'true' };
          else shape = { kind: 'ref', name };
        }
      }
      while (eat('[')) {
        expect(']');
        shape = { kind: 'array', element: shape };
      }
      return shape;
    };
    const items = [atom()];
    while (eat('|')) items.push(atom());
    return items.length === 1 ? items[0] : { kind: 'union', items };
  };
  const models: Model[] = [];
  while (peek().value !== '<EOF>') {
    if (eat('type')) {
      const name = ident();
      if (Object.hasOwn(jsonTypes, name)) error('Duplicate JSON type ' + name);
      expect('=');
      jsonTypes[name] = jsonShape();
      eat(';');
      continue;
    }
    expect('model');
    const name = ident();
    expect('{');
    const fields: Field[] = [];
    const attrs: Attribute[] = [];
    while (!eat('}')) {
      if (peek().value === '<EOF>') error('Unclosed model');
      if (eat('@')) {
        expect('@');
        attrs.push(attribute());
        eat(';');
        continue;
      }
      const token = peek();
      const name = ident();
      const nullable = eat('?');
      expect(':');
      let type: string;
      let choices: string[] | undefined;
      if (peek().kind === 'string') {
        choices = [tokens[p++].value];
        while (eat('|')) {
          if (peek().kind !== 'string') error('Enum members must be strings');
          choices.push(tokens[p++].value);
        }
        type = 'string';
      } else type = ident();
      let json: JsonShape | undefined;
      if (type === 'json') {
        expect('<');
        json = jsonShape();
        expect('>');
      }
      let maxLength: number | undefined;
      let precision: number | undefined;
      let scale: number | undefined;
      if (eat('(')) {
        if (type === 'decimal') {
          precision = Number(tokens[p++].value);
          expect(',');
          scale = Number(tokens[p++].value);
          if (
            !Number.isInteger(precision) ||
            !Number.isInteger(scale) ||
            precision < 1 ||
            precision > 65 ||
            scale < 0 ||
            scale > Math.min(30, precision)
          )
            error('decimal(precision, scale) requires 1 <= precision <= 65 and 0 <= scale <= min(30, precision)');
        } else {
          if (type !== 'string') error('Only string supports a length');
          maxLength = Number(tokens[p++].value);
          if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 16383)
            error('String length must be 1..16383');
        }
        expect(')');
      }
      let many = false;
      if (eat('[')) {
        expect(']');
        many = true;
      }
      const f: Field = {
        name,
        type,
        nullable,
        many,
        attrs: [],
        token,
        json,
        maxLength,
        precision,
        scale,
        enum: choices,
      };
      if (eat('=')) f.default = value();
      while (peek().value === '@' && tokens[p + 1].value !== '@') {
        expect('@');
        const a = attribute();
        if (f.attrs.some((x) => x.name === a.name)) error(`Duplicate @${a.name}`, token);
        f.attrs.push(a);
      }
      eat(';');
      fields.push(f);
    }
    models.push({ name, fields, attrs });
  }
  const reservedJsonNames = new Set([
    'string',
    'number',
    'boolean',
    'null',
    'true',
    'false',
    'any',
    'unknown',
    'never',
    'void',
    'undefined',
    'symbol',
    'bigint',
    'object',
    'Schema',
    'ClientOptions',
    'FieldUpdate',
    'DecimalUpdate',
    'Where',
    'DateTime',
    'DateTimeInput',
    'JsonInput',
    'Virtuals',
    'Models',
    'DistributiveOmit',
    'OneOf',
    'AtLeastOne',
    'Record',
    ...models.flatMap((m) =>
      ['Row', 'Create', 'Update', 'Unique', 'ScalarCreate', 'ScalarUpdate'].map(
        (suffix) => m.name + suffix,
      ),
    ),
  ]);
  for (const name of Object.keys(jsonTypes))
    if (reservedJsonNames.has(name))
      error('JSON type name conflicts with generated types: ' + name);
  const tables: Record<string, Table> = Object.create(null);
  const scalar = new Set(['int', 'bigint', 'number', 'decimal', 'string', 'boolean', 'date', 'json', 'bytes']);
  const mapName = (a: Attribute | undefined, token?: Token) => {
    if (!a) return undefined;
    if (a.args.length !== 1 || typeof a.args[0] !== 'string' || !a.args[0] || Object.keys(a.options).length)
      error(`@${token ? '' : '@'}map requires one non-empty string`, token);
    return a.args[0] as string;
  };
  const get = (f: Field, n: string) => f.attrs.find((a) => a.name === n);
  const reserved = new Set(['__proto__', 'constructor', 'prototype', 'AND', 'OR', 'NOT', '_count']);
  for (const m of models) {
    if (tables[m.name] || reserved.has(m.name) || m.name.startsWith('$'))
      error(`Invalid or duplicate model ${m.name}`);
    if (
      models.some(
        (other) =>
          other !== m &&
          other.name[0].toLowerCase() + other.name.slice(1) ===
            m.name[0].toLowerCase() + m.name.slice(1),
      )
    )
      error('Client model name collision');
    const t: Table = {
      name: m.name,
      columns: Object.create(null),
      relations: Object.create(null),
      primary: '',
      unique: [],
      indexes: [],
    };
    const tableMap = mapName(m.attrs.find((a) => a.name === 'map'));
    if (tableMap) t.map = tableMap;
    tables[m.name] = t;
    const seen = new Set<string>();
    for (const f of m.fields) {
      if (
        seen.has(f.name) ||
        reserved.has(f.name) ||
        f.name.startsWith('$') ||
        f.name.startsWith('__orm_')
      )
        error(`Invalid or duplicate field ${f.name}`, f.token);
      seen.add(f.name);
      for (const a of f.attrs)
        if (!['id', 'auto', 'unique', 'via', 'relation', 'updatedAt', 'map'].includes(a.name))
          error(`Unsupported @${a.name}`, f.token);
      for (const a of f.attrs.filter((a) => ['id', 'auto', 'unique', 'updatedAt'].includes(a.name)))
        if (a.args.length || Object.keys(a.options).length)
          error(`@${a.name} takes no arguments`, f.token);
      if (!scalar.has(f.type)) continue;
      if (f.many || get(f, 'via') || get(f, 'relation'))
        error('Scalar fields cannot be relations or arrays', f.token);
      const col: Column = {
        name: f.name,
        type: f.type as Scalar,
        nullable: f.nullable,
        primary: !!get(f, 'id'),
        auto: !!get(f, 'auto'),
        unique: !!get(f, 'unique'),
        enum: f.enum,
        maxLength: f.maxLength,
        ...(f.precision !== undefined ? { precision: f.precision, scale: f.scale } : {}),
        ...(get(f, 'updatedAt') ? { updatedAt: true } : {}),
        ...(get(f, 'map') ? { map: mapName(get(f, 'map'), f.token) } : {}),
        ...(f.json ? { json: { root: f.json, definitions: jsonTypes } } : {}),
      };
      if (col.updatedAt && (col.type !== 'date' || f.default !== undefined || col.primary || col.unique))
        error('@updatedAt requires a date field without default, @id or @unique', f.token);
      if (f.default !== undefined) col.default = f.default;
      else if (f.nullable) col.default = null;
      if (
        col.type === 'json' &&
        (col.primary ||
          col.unique ||
          col.auto ||
          (col.default !== undefined && col.default !== null))
      )
        error('JSON does not support keys or non-null defaults', f.token);
      if (col.type === 'bytes' && (col.primary || col.unique))
        error('Bytes fields cannot be keys', f.token);
      if (col.primary) {
        if (t.primary || col.nullable) error('Exactly one non-null primary key required', f.token);
        t.primary = f.name;
      }
      if (
        col.auto &&
        (!col.primary || !['int', 'bigint'].includes(col.type) || col.default !== undefined)
      )
        error('@auto requires int or bigint @id without default', f.token);
      if (col.default !== undefined) {
        const d = col.default;
        if (d && typeof d === 'object') {
          if ((d.fn === 'now' && col.type !== 'date') || (d.fn === 'uuid' && col.type !== 'string'))
            error('Default function type mismatch', f.token);
        } else if (
          d === null
            ? !col.nullable
            : col.type === 'date' ||
              (col.type === 'decimal'
                ? !(typeof d === 'number' || (typeof d === 'string' && /^-?\d+(\.\d+)?$/.test(d)))
                : typeof d !==
                  (['int', 'bigint'].includes(col.type) ? 'number' : col.type)) ||
              (['int', 'bigint'].includes(col.type) && !Number.isSafeInteger(d)) ||
              (col.enum && !col.enum.includes(d as string))
        )
          error('Invalid default value', f.token);
      }
      if (
        col.maxLength &&
        ((typeof col.default === 'string' && [...col.default].length > col.maxLength) ||
          (col.default &&
            typeof col.default === 'object' &&
            col.default.fn === 'uuid' &&
            col.maxLength < 36))
      )
        error('Default exceeds string length', f.token);
      t.columns[f.name] = col;
    }
    if (m.attrs.some((a) => a.name === 'id')) {
      if (t.primary) error(`Model ${m.name} cannot combine @id with @@id`);
      t.primaryKey = [];
    } else if (!t.primary) error(`Model ${m.name} needs one scalar @id or @@id`);
  }
  for (const m of models)
    for (const f of m.fields.filter((f) => !scalar.has(f.type))) {
      const t = tables[m.name];
      const target = tables[f.type];
      if (f.type === 'Date') error('The date type is spelled date', f.token);
      if (!target) error(`Unknown model ${f.type}`, f.token);
      if (!get(f, 'via') && (target.primaryKey || (f.many && t.primaryKey)))
        error('Relations cannot reference a model with a composite @@id', f.token);
      if (f.default !== undefined || get(f, 'auto') || get(f, 'id'))
        error('Invalid relation attribute/default', f.token);
      if (get(f, 'via')) continue;
      if (f.many) {
        if (f.nullable || get(f, 'unique') || get(f, 'relation'))
          error('Invalid many-to-many options', f.token);
        const junction = `_${m.name}_${f.name}`;
        if (tables[junction]) error('Junction table name collision', f.token);
        t.relations[f.name] = {
          name: f.name,
          target: f.type,
          many: true,
          nullable: false,
          owner: true,
          source: t.primary,
          foreign: target.primary,
          junction,
          junctionSource: 'sourceId',
          junctionTarget: 'targetId',
        };
        continue;
      }
      const a = get(f, 'relation');
      // 外键只能是一列，选项名用单数；旧写法给出改名提示。
      if (a && 'fields' in a.options)
        error('@relation(fields: ...) is renamed to @relation(field: ...)', f.token);
      if (
        a?.args.length ||
        Object.keys(a?.options ?? {}).some((k) => !['field', 'onDelete', 'onUpdate'].includes(k))
      )
        error('@relation supports field, onDelete and onUpdate', f.token);
      const actions: Pick<Relation, 'onDelete' | 'onUpdate'> = {};
      for (const key of ['onDelete', 'onUpdate'] as const) {
        const action = a?.options[key];
        if (action === undefined) continue;
        if (!['Cascade', 'Restrict', 'NoAction', 'SetNull'].includes(action))
          error(`${key} must be Cascade, Restrict, NoAction or SetNull`, f.token);
        if (action === 'SetNull' && !f.nullable)
          error(`${key}: SetNull requires an optional relation`, f.token);
        actions[key] = action;
      }
      const fk: string =
        a?.options.field ??
        `${f.name}${target.primary[0].toUpperCase()}${target.primary.slice(1)}`;
      if (typeof fk !== 'string') error('field must name one scalar column', f.token);
      const targetCol = target.columns[target.primary];
      if (a?.options.field) {
        const col = t.columns[fk];
        if (
          !col ||
          col.type !== targetCol.type ||
          col.maxLength !== targetCol.maxLength ||
          col.nullable !== f.nullable ||
          col.primary ||
          col.auto ||
          col.enum
        )
          error('Foreign key column type/nullability mismatch', f.token);
        if (get(f, 'unique')) col.unique = true;
      } else {
        if (m.fields.some((x) => x.name === fk) || t.columns[fk])
          error(`Generated field ${fk} collides; bind with @relation(field: ${fk})`, f.token);
        t.columns[fk] = {
          name: fk,
          type: targetCol.type,
          maxLength: targetCol.maxLength,
          nullable: f.nullable,
          primary: false,
          auto: false,
          unique: !!get(f, 'unique'),
          ...(f.nullable ? { default: null } : {}),
        };
      }
      if (Object.values(t.relations).some((r) => r.owner && !r.many && r.source === fk))
        error('Foreign key cannot be owned by multiple relations', f.token);
      t.relations[f.name] = {
        name: f.name,
        target: f.type,
        many: false,
        nullable: f.nullable,
        owner: true,
        source: fk,
        foreign: target.primary,
        ...actions,
      };
    }
  for (const m of models)
    for (const f of m.fields) {
      const via = get(f, 'via');
      if (!via) continue;
      if (
        via.args.length !== 1 ||
        typeof via.args[0] !== 'string' ||
        Object.keys(via.options).length ||
        f.attrs.length !== 1
      )
        error('@via requires one target relation name', f.token);
      const t = tables[m.name];
      const target = tables[f.type];
      const original = target?.relations[via.args[0]];
      if (!original || !original.owner || original.target !== m.name)
        error('Invalid inverse relation target', f.token);
      if (original.junction) {
        if (!f.many || f.nullable) error('Inverse many-to-many must be an array', f.token);
      } else {
        const unique = target.columns[original.source].unique;
        if (f.many === unique || (!f.many && !f.nullable) || (f.many && f.nullable))
          error(
            'Inverse cardinality must match foreign key uniqueness; single inverse must be optional',
            f.token,
          );
      }
      if (
        Object.values(t.relations).some(
          (r) =>
            !r.owner &&
            r.target === f.type &&
            r.source === original.foreign &&
            r.foreign === original.source &&
            r.junction === original.junction,
        )
      )
        error('Duplicate inverse relation', f.token);
      t.relations[f.name] = {
        name: f.name,
        target: f.type,
        many: f.many,
        nullable: f.nullable,
        owner: false,
        source: original.foreign,
        foreign: original.source,
        ...(original.junction
          ? {
              junction: original.junction,
              junctionSource: original.junctionTarget,
              junctionTarget: original.junctionSource,
            }
          : {}),
      };
    }
  /** @@id、@@unique、@@index 只接受裸字段名，方括号写法直接拒绝。 */
  const fieldKeys = (args: any[]): string[] => {
    if (args.some((k) => Array.isArray(k))) error('Field lists take bare names, not brackets');
    const keys = args.filter((k) => typeof k === 'string');
    if (keys.length !== args.length) error('Invalid index fields');
    return keys;
  };
  for (const m of models)
    for (const a of m.attrs) {
      if (a.name === 'map') continue;
      if (a.name === 'id') {
        const table = tables[m.name];
        const keys = fieldKeys(a.args).map((k) => table.relations[k]?.source ?? k);
        if (
          Object.keys(a.options).length ||
          keys.length < 2 ||
          new Set(keys).size !== keys.length ||
          keys.some((k) => {
            const c = table.columns[k];
            return !c || c.nullable || c.type === 'json' || c.type === 'bytes';
          })
        )
          error('@@id requires two or more distinct non-null scalar fields; use @id for one');
        table.primaryKey = keys;
        continue;
      }
      if (a.name === 'softDelete') {
        const table = tables[m.name];
        if (a.args.length > 1 || Object.keys(a.options).length)
          error('@@softDelete takes at most one field name');
        // 省略参数时默认使用 deletedAt；该字段未声明时自动补上可空 date 列。
        const field = a.args[0] ?? 'deletedAt';
        if (typeof field !== 'string' || (a.args.length && !table.columns[field]))
          error('@@softDelete requires one nullable date field');
        if (!table.columns[field])
          table.columns[field] = {
            name: field,
            type: 'date',
            nullable: true,
            primary: false,
            auto: false,
            unique: false,
            default: null,
          };
        const column = table.columns[field];
        if (
          column.type !== 'date' ||
          column.default !== null ||
          !column.nullable ||
          column.primary ||
          column.unique ||
          table.softDelete
        )
          error('@@softDelete requires one nullable date field');
        table.softDelete = field;
        continue;
      }

      if (!['unique', 'index'].includes(a.name) || Object.keys(a.options).length || !a.args.length)
        error(`Unsupported @@${a.name}; use @@id, @@unique, @@index, @@map or @@softDelete`);
      const keys = fieldKeys(a.args).map((k) => tables[m.name].relations[k]?.source ?? k);
      if (keys.some((k) => !tables[m.name].columns[k]) || new Set(keys).size !== keys.length)
        error('Invalid index fields');
      if (keys.some((k) => tables[m.name].columns[k].type === 'bytes'))
        error('Bytes fields cannot be indexed');
      tables[m.name][a.name === 'unique' ? 'unique' : 'indexes'].push(keys);
    }
  const inspect = (shape: JsonShape, seen = new Set<string>()): void => {
    if (shape.kind === 'ref') {
      if (!jsonTypes[shape.name]) error('Unknown JSON type ' + shape.name);
      if (!seen.has(shape.name)) {
        const next = new Set(seen);
        next.add(shape.name);
        inspect(jsonTypes[shape.name], next);
      }
    } else if (shape.kind === 'object') {
      for (const field of Object.values(shape.fields)) inspect(field.shape, seen);
    } else if (shape.kind === 'array') inspect(shape.element, seen);
    else if (shape.kind === 'record') inspect(shape.value, seen);
    else if (shape.kind === 'union') shape.items.forEach((item) => inspect(item, seen));
  };
  Object.values(jsonTypes).forEach((shape) => inspect(shape));
  for (const table of Object.values(tables)) {
    for (const column of Object.values(table.columns)) if (column.json) inspect(column.json.root);
    for (const keys of [...table.unique, ...table.indexes])
      if (keys.some((key) => table.columns[key].type === 'json'))
        error('JSON index requires explicit database support');
  }
  return { version: 1, tables, ...(Object.keys(jsonTypes).length ? { jsonTypes } : {}) };
}
export { generateClient } from './generate.js';
