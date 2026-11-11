import type { Spec } from "./types.js";
import type { Schema } from "../schema/index.js";
import { fail } from "../shared/errors.js";
import { checkObject } from "../shared/validation.js";
export type Virtuals<S extends Spec> = {
  [K in keyof S as Uncapitalize<K & string>]?: Record<
    string,
    {
      needs: Partial<Record<keyof S[K]["row"], true>>;
      compute: (row: Readonly<S[K]["row"]>) => unknown;
    }
  >;
};
type Values<V> = {
  [F in keyof V]: V[F] extends { compute: (...args: any[]) => infer R } ? R : never;
};
/**
 * Adds the virtual fields of `V` to each model's row. Models without virtual fields, and the
 * whole map when there are none, are returned as is so hovers keep the plain generated names.
 */
export type WithVirtuals<S extends Spec, V> = [keyof V] extends [never]
  ? S
  : {
      [K in keyof S]: Uncapitalize<K & string> extends keyof V
        ? Omit<S[K], "row" | "virtualFields"> & {
            row: Omit<S[K]["row"], keyof Values<V[Uncapitalize<K & string>]>> & Values<V[Uncapitalize<K & string>]>;
            virtualFields: (S[K] extends { virtualFields: infer F extends string } ? F : never) | (keyof V[Uncapitalize<K & string>] & string);
          }
        : S[K];
    };
export function withVirtuals(schema: Schema, definitions: any): Schema {
  if (definitions === undefined) {
    return schema;
  }
  checkObject(definitions, "virtuals");
  const tables = { ...schema.tables };
  for (const [model, fields] of Object.entries(definitions)) {
    const table = Object.values(tables).find((t) => {
      return t.name[0].toLowerCase() + t.name.slice(1) === model;
    });
    if (!table) {
      return fail("Unknown virtual model " + model);
    }
    checkObject(fields, "virtual fields");
    const virtuals: any = {};
    for (const [name, input] of Object.entries(fields as object)) {
      const field = input as any;
      if (table.columns[name] || table.relations[name] || name === "then" || name.startsWith("_") || name.startsWith("$")) {
        fail("Virtual field name conflicts: " + name);
      }
      if (!field || typeof field.compute !== "function" || !field.needs || typeof field.needs !== "object") {
        fail("Virtual field requires needs and compute");
      }
      checkObject(field.needs, "virtual dependencies");
      const needs = Object.keys(field.needs);
      if (
        needs.some((key) => {
          return field.needs[key] !== true || !table.columns[key];
        })
      ) {
        fail("Virtual dependencies must be physical scalar fields; virtual cycles are not allowed");
      }
      virtuals[name] = { needs, compute: field.compute };
    }
    // Merge instead of replace so `$extend` layers on top of the existing virtual fields.
    tables[table.name] = { ...table, virtuals: { ...table.virtuals, ...virtuals } };
  }
  return { ...schema, tables };
}
