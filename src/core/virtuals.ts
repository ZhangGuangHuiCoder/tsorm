import type { Spec } from './types.js';
import type { Schema } from '../schema/index.js';
import { fail } from '../shared/errors.js';
export type Virtuals<S extends Spec> = {
  [K in keyof S as Uncapitalize<K & string>]?: Record<
    string,
    {
      needs: Partial<Record<keyof S[K]['row'], true>>;
      compute: (row: Readonly<S[K]['row']>) => unknown;
    }
  >;
};
type Values<V> = {
  [F in keyof V]: V[F] extends { compute: (...args: any[]) => infer R } ? R : never;
};
export type WithVirtuals<S extends Spec, V> = {
  [K in keyof S]: Omit<S[K], 'row' | 'virtualFields'> & {
    row: S[K]['row'] &
      Values<Uncapitalize<K & string> extends keyof V ? V[Uncapitalize<K & string>] : {}>;
    virtualFields: Uncapitalize<K & string> extends keyof V
      ? keyof V[Uncapitalize<K & string>] & string
      : never;
  };
};
export function virtualField<Row extends Record<string, any>>() {
  return <const N extends Partial<Record<keyof Row, true>>, R>(definition: {
    needs: N;
    compute: (row: Readonly<Pick<Row, keyof N & keyof Row>>) => R;
  }) => definition;
}
export function withVirtuals(schema: Schema, definitions: any): Schema {
  if (definitions === undefined) return schema;
  const tables = { ...schema.tables };
  for (const [model, fields] of Object.entries(definitions)) {
    const table = Object.values(tables).find(
      (t) => t.name[0].toLowerCase() + t.name.slice(1) === model,
    );
    if (!table) return fail('Unknown virtual model ' + model);
    const virtuals: any = {};
    for (const [name, input] of Object.entries(fields as object)) {
      const field = input as any;
      if (
        table.columns[name] ||
        table.relations[name] ||
        name === 'then' ||
        name.startsWith('_') ||
        name.startsWith('$')
      )
        fail('Virtual field name conflicts: ' + name);
      if (
        !field ||
        typeof field.compute !== 'function' ||
        !field.needs ||
        typeof field.needs !== 'object'
      )
        fail('Virtual field requires needs and compute');
      const needs = Object.keys(field.needs);
      if (needs.some((key) => field.needs[key] !== true || !table.columns[key]))
        fail('Virtual dependencies must be physical scalar fields; virtual cycles are not allowed');
      virtuals[name] = { needs, compute: field.compute };
    }
    tables[table.name] = { ...table, virtuals };
  }
  return { ...schema, tables };
}
