import { fail, OrmError } from "./errors.js";

// ─── JSON shape and codec ──────────────────────────────────────────────────
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
/** Lazy path node: joins the parent path and key into the original format string only when an error is thrown. */
interface PathNode {
  parent: PathNode | null;
  segment: string;
}
interface MatchFailure {
  /** null means the message does not depend on a path (e.g. Unknown JSON type); text is then the complete message. */
  path: PathNode | null;
  text: string;
}
interface MatchState {
  failure: MatchFailure | null;
}
const renderPath = (node: PathNode): string => {
  let text = node.segment;
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    text = parent.segment + text;
  }
  return text;
};
/** Records only the first failure and returns false for explicit union branch control; never throws or renders successful paths. */
const failMatch = (state: MatchState, path: PathNode | null, text: string): false => {
  if (state.failure === null) {
    state.failure = { path, text };
  }
  return false;
};
/** Uses the same rules as matches, but returns booleans instead of try/catch for union branches; messages are rendered only on failure. */
function checkMatch(shape: JsonShape, value: any, defs: Record<string, JsonShape>, node: PathNode, depth: number, state: MatchState): boolean {
  if (depth > 64) {
    return failMatch(state, node, ": JSON nesting exceeds 64");
  }
  if (shape.kind === "ref") {
    const target = defs[shape.name];
    if (!target) {
      return failMatch(state, null, "Unknown JSON type " + shape.name);
    }
    return checkMatch(target, value, defs, node, depth + 1, state);
  }
  if (shape.kind === "union") {
    const branch: MatchState = { failure: null };
    for (const item of shape.items) {
      branch.failure = null;
      if (checkMatch(item, value, defs, node, depth + 1, branch)) {
        return true;
      }
    }
    return failMatch(state, node, ": does not match JSON union");
  }
  if (shape.kind === "literal") {
    return value === shape.value ? true : failMatch(state, node, ": invalid literal");
  }
  if (shape.kind === "primitive") {
    if (shape.name === "null" ? value !== null : typeof value !== shape.name || (shape.name === "number" && !Number.isFinite(value))) {
      return failMatch(state, node, ": expected " + shape.name);
    }
    return true;
  }
  if (shape.kind === "array") {
    if (!Array.isArray(value)) {
      return failMatch(state, node, ": expected array");
    }
    if (Object.hasOwn(value, "toJSON")) {
      return failMatch(state, node, ": custom JSON serialization is not allowed");
    }
    for (let i = 0; i < value.length; i++) {
      const property = Object.getOwnPropertyDescriptor(value, String(i));
      const elementNode: PathNode = { parent: node, segment: "[" + i + "]" };
      if (!property || !property.enumerable || !Object.hasOwn(property, "value")) {
        return failMatch(state, elementNode, ": expected an own enumerable data element");
      }
      if (!checkMatch(shape.element, property.value, defs, elementNode, depth + 1, state)) {
        return false;
      }
    }
    return true;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return failMatch(state, node, ": expected plain object");
  }
  // getOwnPropertyNames returns the same keys as Object.entries(Object.getOwnPropertyDescriptors(value)).
  // Reading each descriptor preserves rejection of getters and non-enumerable properties without allocating all descriptors at once.
  const keys = Object.getOwnPropertyNames(value);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!property.enumerable || !Object.hasOwn(property, "value")) {
      return failMatch(state, { parent: node, segment: "." + key }, ": expected an enumerable data property");
    }
  }
  if (shape.kind === "record") {
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!checkMatch(shape.value, property.value, defs, { parent: node, segment: "." + key }, depth + 1, state)) {
        return false;
      }
    }
    return true;
  }
  for (const key of keys) {
    if (!Object.hasOwn(shape.fields, key)) {
      return failMatch(state, { parent: node, segment: "." + key }, ": unknown property");
    }
  }
  for (const key of Object.keys(shape.fields)) {
    const field = shape.fields[key];
    const fieldNode: PathNode = { parent: node, segment: "." + key };
    if (!Object.hasOwn(value, key)) {
      if (field.optional) {
        continue;
      }
      return failMatch(state, fieldNode, ": required");
    }
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!checkMatch(field.shape, property.value, defs, fieldNode, depth + 1, state)) {
      return false;
    }
  }
  return true;
}
function matches(shape: JsonShape, value: any, defs: Record<string, JsonShape>, path: string, depth = 0): void {
  const state: MatchState = { failure: null };
  if (checkMatch(shape, value, defs, { parent: null, segment: path }, depth, state)) {
    return;
  }
  const failure = state.failure!;
  fail(failure.path === null ? failure.text : renderPath(failure.path) + failure.text);
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
