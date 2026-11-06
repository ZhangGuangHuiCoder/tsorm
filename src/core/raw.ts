import type { RuntimeAdapter, CompiledSQL } from './adapter.js';
import { fail } from '../shared/errors.js';
const brand = Symbol('SQL');
export interface SqlQuery {
  readonly strings: readonly string[];
  readonly values: readonly unknown[];
  readonly [brand]: true;
}
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw'))
    fail('Use sql as a tagged template');
  const fragments: string[] = [strings[0]];
  const parameters: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (isSql(value)) {
      fragments[fragments.length - 1] += value.strings[0];
      for (let j = 0; j < value.values.length; j++) {
        parameters.push(value.values[j]);
        fragments.push(value.strings[j + 1]);
      }
    } else {
      parameters.push(value);
      fragments.push('');
    }
    fragments[fragments.length - 1] += strings[i + 1];
  }
  return Object.freeze({
    strings: Object.freeze(fragments),
    values: Object.freeze(parameters),
    [brand]: true as const,
  });
}
function isSql(value: unknown): value is SqlQuery {
  return typeof value === 'object' && value !== null && (value as SqlQuery)[brand] === true;
}
export function rawQuery(query: SqlQuery | TemplateStringsArray, values: unknown[]): SqlQuery {
  if (isSql(query)) {
    if (values.length) fail('Unexpected raw query parameters');
    return query;
  }
  return sql(query as TemplateStringsArray, ...values);
}
export function compileRaw(adapter: RuntimeAdapter, query: SqlQuery): CompiledSQL {
  const d = adapter.dialect;
  const values = query.values.map((value) => {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
      fail('Invalid SQL parameter');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('SQL number must be finite');
    if (value instanceof Date || typeof value === 'boolean') {
      return d.encode(
        {
          name: 'parameter',
          type: value instanceof Date ? 'date' : 'boolean',
          nullable: false,
          primary: false,
          auto: false,
          unique: false,
        },
        value,
      );
    }
    if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array))
      fail('SQL object parameters must be explicitly serialized');
    return value;
  });
  return {
    text: query.strings
      .map((text, i) => text + (i < values.length ? d.parameter(i + 1) : ''))
      .join(''),
    values,
  };
}
export interface RawClient {
  $queryRaw<T = unknown>(query: SqlQuery | TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: SqlQuery | TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
