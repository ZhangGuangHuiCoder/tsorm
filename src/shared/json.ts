import { fail, OrmError } from "./errors.js";
export type JsonShape =
  | { kind: "primitive"; name: "string" | "number" | "boolean" | "null" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "array"; element: JsonShape }
  | { kind: "union"; items: JsonShape[] }
  | { kind: "object"; fields: Record<string, { optional: boolean; shape: JsonShape }> }
  | { kind: "record"; value: JsonShape }
  | { kind: "ref"; name: string };
export interface JsonDefinition {
  root: JsonShape;
  definitions: Record<string, JsonShape>;
}
const nullKind = Symbol("JSON null");
export const DbNull = Object.freeze({ [nullKind]: "database" as const });
export const JsonNull = Object.freeze({ [nullKind]: "json" as const });
export type JsonInput<T, Nullable extends boolean = false> = Exclude<T, null> | (null extends T ? typeof JsonNull : never) | (Nullable extends true ? typeof DbNull | null : never);
function matches(shape: JsonShape, value: any, defs: Record<string, JsonShape>, path: string, depth = 0): void {
  if (depth > 64) {
    fail(path + ": JSON nesting exceeds 64");
  }
  if (shape.kind === "ref") {
    const target = defs[shape.name];
    if (!target) {
      fail("Unknown JSON type " + shape.name);
    }
    return matches(target, value, defs, path, depth + 1);
  }
  if (shape.kind === "union") {
    for (const item of shape.items) {
      try {
        matches(item, value, defs, path, depth + 1);
        return;
      } catch (error) {
        if (!(error instanceof OrmError) || error.code !== "VALIDATION") {
          throw error;
        }
      }
    }
    return fail(path + ": does not match JSON union");
  }
  if (shape.kind === "literal") {
    if (value !== shape.value) {
      fail(path + ": invalid literal");
    }
    return;
  }
  if (shape.kind === "primitive") {
    if (shape.name === "null" ? value !== null : typeof value !== shape.name || (shape.name === "number" && !Number.isFinite(value))) {
      fail(path + ": expected " + shape.name);
    }
    return;
  }
  if (shape.kind === "array") {
    if (!Array.isArray(value)) {
      fail(path + ": expected array");
    }
    if (Object.hasOwn(value, "toJSON")) {
      fail(path + ": custom JSON serialization is not allowed");
    }
    for (let i = 0; i < value.length; i++) {
      const property = Object.getOwnPropertyDescriptor(value, String(i));
      if (!property || !property.enumerable || !Object.hasOwn(property, "value")) {
        return fail(path + "[" + i + "]: expected an own enumerable data element");
      }
      matches(shape.element, property.value, defs, path + "[" + i + "]", depth + 1);
    }
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(path + ": expected plain object");
  }
  const properties = Object.getOwnPropertyDescriptors(value);
  for (const [key, property] of Object.entries(properties)) {
    if (!property.enumerable || !Object.hasOwn(property, "value")) {
      fail(path + "." + key + ": expected an enumerable data property");
    }
  }
  if (shape.kind === "record") {
    for (const [key, property] of Object.entries(properties)) {
      matches(shape.value, property.value, defs, path + "." + key, depth + 1);
    }
    return;
  }
  for (const key of Object.keys(properties)) {
    if (!Object.hasOwn(shape.fields, key)) {
      fail(path + "." + key + ": unknown property");
    }
  }
  for (const [key, field] of Object.entries(shape.fields)) {
    if (!Object.hasOwn(properties, key)) {
      if (field.optional) {
        continue;
      }
      fail(path + "." + key + ": required");
    }
    matches(field.shape, properties[key].value, defs, path + "." + key, depth + 1);
  }
}
export function encodeJson(definition: JsonDefinition, value: any, nullable: boolean, path: string): string | null {
  if (value === DbNull || value === null) {
    if (!nullable) {
      fail(path + ": database NULL is not allowed");
    }
    return null;
  }
  const actual = value === JsonNull ? null : value;
  matches(definition.root, actual, definition.definitions, path);
  try {
    return JSON.stringify(actual);
  } catch {
    return fail(path + ": invalid JSON value");
  }
}
export function decodeJson(definition: JsonDefinition, value: any, nullable: boolean, path: string): any {
  try {
    if (value === null) {
      if (!nullable) {
        fail(path + ": database NULL is not allowed");
      }
      return null;
    }
    const result = typeof value === "string" ? JSON.parse(value) : value;
    matches(definition.root, result, definition.definitions, path);
    return result;
  } catch (error) {
    throw new OrmError("INVALID_DATABASE_VALUE", path + ": invalid database JSON", {
      cause: error,
    });
  }
}
export function jsonTypeText(shape: JsonShape): string {
  switch (shape.kind) {
    case "primitive":
      return shape.name;
    case "literal":
      return JSON.stringify(shape.value);
    case "ref":
      return shape.name;
    case "array":
      return "(" + jsonTypeText(shape.element) + ")[]";
    case "union":
      return shape.items.map(jsonTypeText).join(" | ");
    case "record":
      return "Record<string," + jsonTypeText(shape.value) + ">";
    case "object":
      return (
        "{" +
        Object.entries(shape.fields)
          .map(([key, field]) => {
            return JSON.stringify(key) + (field.optional ? "?" : "") + ":" + jsonTypeText(field.shape);
          })
          .join("; ") +
        "}"
      );
  }
}
