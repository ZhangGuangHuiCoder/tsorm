import type { JsonShape } from "../shared/index.js";
import { internalColumnName, internalGeneratedSuffixes, internalHistoryTableName, internalIgnoredTable, internalModelKey, internalTableName, type Column, type Relation, type Scalar, type Schema, type Table } from "./model.js";
export class SchemaError extends Error {
  constructor(
    message: string,
    public line = 0,
    public column = 0,
  ) {
    super(`${line}:${column} ${message}`);
    this.name = "SchemaError";
  }
}
/** Defaults `string` to length 191, covering byte-based index limits consistently across dialects. */
const defaultStringLength = 191;
/** JS type a literal default must have, given the column type. */
function defaultLiteralType(col: Column): string {
  if (col.type === "int" || col.type === "bigint") {
    return "number";
  }
  if (col.type === "text") {
    return "string";
  }
  return col.type;
}
/** A literal default must fit the column type, its enum and the safe-integer range. */
function invalidDefault(col: Column, d: any): boolean {
  if (d === null) {
    return !col.nullable;
  }
  if (col.type === "datetime") {
    return true;
  }
  if (col.type === "decimal") {
    const numeric = typeof d === "number" || (typeof d === "string" && /^-?\d+(\.\d+)?$/.test(d));
    if (!numeric) {
      return true;
    }
  } else if (typeof d !== defaultLiteralType(col)) {
    return true;
  }
  if (["int", "bigint"].includes(col.type) && !Number.isSafeInteger(d)) {
    return true;
  }
  return Boolean(col.enum && !col.enum.includes(d as string));
}
type Token = {
  value: string;
  kind: "id" | "string" | "number" | "symbol";
  line: number;
  column: number;
};
type Comment = {
  text: string;
  line: number;
  column: number;
};
function lex(input: string): { tokens: Token[]; comments: Comment[] } {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  let i = 0;
  let line = 1;
  let column = 1;
  const advance = (s: string) => {
    for (const c of s) {
      if (c === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    i += s.length;
  };
  while (i < input.length) {
    const rest = input.slice(i);
    const ignored = /^(?:\s+|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (ignored) {
      advance(ignored[0]);
      continue;
    }
    let match: RegExpExecArray | null;
    if ((match = /^\/\/[^\n]*/.exec(rest))) {
      // Preserve line comment text and positions for table/column attachment; block comments are still skipped.
      const text = match[0].slice(2).trim();
      if (text) {
        comments.push({ text, line, column });
      }
      advance(match[0]);
    } else if ((match = /^"(?:\\.|[^"\\])*"/.exec(rest))) {
      const raw = match[0];
      let value: string;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new SchemaError("Invalid string", line, column);
      }
      tokens.push({ value, kind: "string", line, column });
      advance(raw);
    } else if ((match = /^-?\d+(?:\.\d+)?/.exec(rest))) {
      tokens.push({ value: match[0], kind: "number", line, column });
      advance(match[0]);
    } else if ((match = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      tokens.push({ value: match[0], kind: "id", line, column });
      advance(match[0]);
    } else if ("{}[]():;,@?=|.<>".includes(rest[0])) {
      tokens.push({ value: rest[0], kind: "symbol", line, column });
      advance(rest[0]);
    } else {
      throw new SchemaError(`Unexpected character ${rest[0]}`, line, column);
    }
  }
  tokens.push({ value: "<EOF>", kind: "symbol", line, column });
  return { tokens, comments };
}
type Attribute = {
  name: string;
  args: any[];
  options: Record<string, any>;
};
type Field = {
  dateStorage?: "timestamp";
  json?: JsonShape;
  name: string;
  type: string;
  nullable: boolean;
  many: boolean;
  attrs: Attribute[];
  token: Token;
  default?: Column["default"];
  /** Length of string(n); defaults to defaultStringLength when omitted. */
  maxLength?: number;
  precision?: number;
  scale?: number;
  enum?: string[];
  /** A morph field's two bound column names; an empty array generates both implicitly. */
  morph?: string[];
  /** Trailing // comment on the field line, attached to the column. */
  comment?: string;
};
type Model = {
  name: string;
  fields: Field[];
  attrs: Attribute[];
  /** Consecutive // comment lines immediately before the model. */
  comment?: string;
};
/** Recovery signal for collect mode: error() has recorded the error, so unwind to the nearest recovery point. */
const resume = Symbol("schema-error");
export function parseSchema(input: string): Schema {
  return parse(input, false, []);
}
/**
 * 收集错误而不是遇错即抛：在顶层语句之间恢复，供编辑器诊断一次报出多个错误。
 * Collects errors instead of throwing immediately, recovering between top-level statements so editor diagnostics can report multiple errors at once.
 */
export function schemaErrors(input: string): SchemaError[] {
  const errors: SchemaError[] = [];
  try {
    parse(input, true, errors);
  } catch (e) {
    if (e instanceof SchemaError) {
      // Lexical errors have no recovery point, so record them as-is.
      errors.push(e);
    } else if (e !== resume) {
      throw e;
    }
  }
  return errors;
}
function parse(input: string, recover: boolean, errors: SchemaError[]): Schema {
  const { tokens, comments } = lex(input);
  let p = 0;
  const peek = () => {
    return tokens[p] ?? tokens[tokens.length - 1];
  };
  const error = (message: string, token = peek()): never => {
    const location = token ?? tokens[tokens.length - 1];
    const failure = new SchemaError(message, location.line, location.column);
    if (!recover) {
      throw failure;
    }
    errors.push(failure);
    throw resume;
  };
  const eat = (s: string) => {
    if (peek().value === s) {
      p++;
      return true;
    }
    return false;
  };
  const expect = (s: string) => {
    if (!eat(s)) {
      error(`Expected ${s}, got ${peek().value}`);
    }
  };
  const precedes = (a: { line: number; column: number }, b: { line: number; column: number }) => {
    return a.line < b.line || (a.line === b.line && a.column < b.column);
  };
  // Column comments are limited to 1024 characters; table comments allow more, but the stricter column limit keeps dialects consistent.
  const checkComment = (text: string, at: { line: number; column: number }) => {
    // Count Unicode code points, not UTF-16 code units, so astral characters
    // (e.g. emoji) are not charged twice against the character limit.
    let length = 0;
    for (const _ of text) {
      if (++length > 1024) {
        error("Comment must be at most 1024 characters", { value: "//", kind: "symbol", line: at.line, column: at.column });
        break;
      }
    }
    return text;
  };
  const ident = () => {
    const t = peek();
    if (t.kind !== "id") {
      error("Expected identifier");
    }
    p++;
    return t.value;
  };
  const value = (): any => {
    if (eat("[")) {
      const result = [];
      while (!eat("]")) {
        result.push(value());
        if (!eat(",")) {
          expect("]");
          break;
        }
      }
      return result;
    }
    const t = tokens[p++];
    if (!t) {
      error("Unexpected end");
    }
    if (t.kind === "string") {
      return t.value;
    }
    if (t.kind === "number") {
      return Number(t.value);
    }
    if (t.kind !== "id") {
      error("Expected value", t);
    }
    if (t.value === "true") {
      return true;
    }
    if (t.value === "false") {
      return false;
    }
    if (t.value === "null") {
      return null;
    }
    if (eat("(")) {
      expect(")");
      if (!["now", "uuid"].includes(t.value)) {
        error("Unknown default function", t);
      }
      return { fn: t.value };
    }
    return t.value;
  };
  const attribute = (): Attribute => {
    const name = ident();
    const args: any[] = [];
    const options: Record<string, any> = Object.create(null);
    if (eat("(")) {
      while (!eat(")")) {
        if (peek().kind === "id" && tokens[p + 1].value === ":") {
          const key = ident();
          expect(":");
          if (key in options) {
            error(`Duplicate option ${key}`);
          }
          options[key] = value();
        } else {
          args.push(value());
        }
        if (!eat(",")) {
          expect(")");
          break;
        }
      }
    }
    return { name, args, options };
  };
  const jsonTypes: Record<string, JsonShape> = Object.create(null);
  const jsonShape = (): JsonShape => {
    const atom = (): JsonShape => {
      let shape: JsonShape;
      if (eat("{")) {
        const fields: Record<string, { optional: boolean; shape: JsonShape }> = Object.create(null);
        while (!eat("}")) {
          const name = ident();
          const optional = eat("?");
          expect(":");
          if (Object.hasOwn(fields, name)) {
            error("Duplicate JSON field " + name);
          }
          fields[name] = { optional, shape: jsonShape() };
          eat(";");
          eat(",");
        }
        shape = { kind: "object", fields };
      } else {
        const token = peek();
        if (token.kind === "string" || token.kind === "number") {
          p++;
          shape = {
            kind: "literal",
            value: token.kind === "number" ? Number(token.value) : token.value,
          };
        } else {
          const name = ident();
          if (name === "Record") {
            expect("<");
            expect("string");
            expect(",");
            const value = jsonShape();
            expect(">");
            shape = { kind: "record", value };
          } else if (["string", "number", "boolean", "null"].includes(name)) {
            shape = { kind: "primitive", name: name as "string" };
          } else if (name === "true" || name === "false") {
            shape = { kind: "literal", value: name === "true" };
          } else {
            shape = { kind: "ref", name };
          }
        }
      }
      while (eat("[")) {
        expect("]");
        shape = { kind: "array", element: shape };
      }
      return shape;
    };
    const items = [atom()];
    while (eat("|")) {
      items.push(atom());
    }
    return items.length === 1 ? items[0] : { kind: "union", items };
  };
  const models: Model[] = [];
  const ignore: string[] = [];
  const ignoreKeys = new Set<string>();
  let prefix = "";
  while (peek().value !== "<EOF>") {
    const start = p;
    try {
      if (peek().value === "prefix" && peek().kind === "id") {
        const token = tokens[p++];
        const name = peek();
        if (prefix) {
          error("Duplicate prefix", token);
        }
        if (name.kind !== "string" || !/^[A-Za-z0-9_]+$/.test(name.value)) {
          error("prefix requires a string of letters, digits and underscores", token);
        }
        p++;
        prefix = name.value;
        eat(";");
        continue;
      }
      if (peek().value === "ignore" && peek().kind === "id") {
        const token = tokens[p++];
        const list = value();
        if (
          !Array.isArray(list) ||
          !list.length ||
          list.some((x) => {
            return typeof x !== "string" || !x || x.includes("\0");
          })
        ) {
          error("ignore requires a non-empty list of table name strings", token);
        }
        for (const pattern of list as string[]) {
          if (ignoreKeys.has(pattern.toLowerCase())) {
            error("Duplicate ignore pattern " + pattern, token);
          }
          ignore.push(pattern);
          ignoreKeys.add(pattern.toLowerCase());
        }
        eat(";");
        continue;
      }
      if (eat("type")) {
        const name = ident();
        if (Object.hasOwn(jsonTypes, name)) {
          error("Duplicate JSON type " + name);
        }
        expect("=");
        jsonTypes[name] = jsonShape();
        eat(";");
        continue;
      }
      expect("model");
      const name = ident();
      expect("{");
      const fields: Field[] = [];
      const attrs: Attribute[] = [];
      while (!eat("}")) {
        if (peek().value === "<EOF>") {
          error("Unclosed model");
        }
        if (eat("@")) {
          expect("@");
          attrs.push(attribute());
          eat(";");
          continue;
        }
        const token = peek();
        const name = ident();
        const nullable = eat("?");
        expect(":");
        let type: string;
        let choices: string[] | undefined;
        if (peek().kind === "string") {
          choices = [tokens[p++].value];
          while (eat("|")) {
            if (peek().kind !== "string") {
              error("Enum members must be strings");
            }
            choices.push(tokens[p++].value);
          }
          type = "string";
        } else {
          type = ident();
        }
        const dateStorage = type === "timestamp" ? ("timestamp" as const) : undefined;
        if (dateStorage) {
          type = "datetime";
        }
        // Morph is a third field kind besides scalars and models: bind discriminator and primary key columns, or generate both implicitly.
        let morph: string[] | undefined;
        if (type === "morph") {
          morph = [];
          if (eat("(")) {
            for (let i = 0; i < 2; i++) {
              // Report a morph-specific message for the wrong argument count instead of the generic expect(',') error.
              if (i && !eat(",")) {
                error("morph takes two column names or none", token);
              }
              if (peek().kind !== "id") {
                error("morph takes two column names or none", token);
              }
              morph.push(ident());
            }
            expect(")");
          }
        }
        let json: JsonShape | undefined;
        if (type === "json" && !morph) {
          expect("<");
          json = jsonShape();
          expect(">");
        }
        let maxLength: number | undefined;
        let precision: number | undefined;
        let scale: number | undefined;
        if (!morph && eat("(")) {
          if (type === "decimal") {
            precision = Number(tokens[p++].value);
            expect(",");
            scale = Number(tokens[p++].value);
            if (!Number.isInteger(precision) || !Number.isInteger(scale) || precision < 1 || precision > 65 || scale < 0 || scale > Math.min(30, precision)) {
              error("decimal(precision, scale) requires 1 <= precision <= 65 and 0 <= scale <= min(30, precision)");
            }
          } else {
            if (type !== "string") {
              error("Only string supports a length");
            }
            maxLength = Number(tokens[p++].value);
            if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 16383) {
              error("String length must be 1..16383");
            }
          }
          expect(")");
        }
        let many = false;
        if (eat("[")) {
          expect("]");
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
          maxLength: maxLength ?? (type === "string" ? defaultStringLength : undefined),
          precision,
          scale,
          enum: choices,
          dateStorage,
          morph,
        };
        if (eat("=")) {
          f.default = value();
        }
        while (peek().value === "@" && tokens[p + 1].value !== "@") {
          expect("@");
          const a = attribute();
          if (
            f.attrs.some((x) => {
              return x.name === a.name;
            })
          ) {
            error(`Duplicate @${a.name}`, token);
          }
          f.attrs.push(a);
        }
        eat(";");
        // Attach trailing // comments on field lines to columns; standalone comments are not attached.
        const end = tokens[p - 1];
        const trailing = comments.find((c) => {
          return c.line === end.line && precedes(end, c);
        });
        if (trailing) {
          f.comment = checkComment(trailing.text, trailing);
        }
        fields.push(f);
      }
      // Attach consecutive // comments immediately before a model (with no intervening token since the previous statement) as the table comment, joined by newlines.
      const leading = comments.filter((c) => {
        return (!tokens[start - 1] || precedes(tokens[start - 1], c)) && precedes(c, tokens[start]);
      });
      const tableComment = leading
        .map((c) => {
          return c.text;
        })
        .join("\n");
      models.push({ name, fields, attrs, ...(tableComment ? { comment: checkComment(tableComment, leading[0]) } : {}) });
    } catch (e) {
      if (e !== resume) {
        throw e;
      }
      // Skip the damaged statement to the next top-level keyword; do not parse the remainder of a partial model.
      let depth = 0;
      p = start;
      while (p < tokens.length && tokens[p].value !== "<EOF>") {
        const t = tokens[p];
        if (p > start && depth === 0 && t.kind === "id" && ["model", "type", "prefix", "ignore"].includes(t.value)) {
          break;
        }
        if (["{", "(", "[", "<"].includes(t.value)) {
          depth++;
        } else if (["}", ")", "]", ">"].includes(t.value)) {
          depth = Math.max(0, depth - 1);
        }
        p++;
      }
      if (p === start) {
        p++;
      }
    }
  }
  if (recover && errors.length) {
    // Syntax errors have been collected; skip semantic validation to avoid cascading Unknown model errors from missing models.
    return { version: 1, tables: Object.create(null) };
  }
  const generatedNames = new Set<string>();
  for (const model of models) {
    for (const suffix of internalGeneratedSuffixes) {
      const name = model.name + suffix;
      if (generatedNames.has(name)) {
        error("Generated type name collision: " + name);
      }
      generatedNames.add(name);
    }
  }
  // Names a JSON type cannot take: TypeScript keywords and built-ins, and the names the generated client declares.
  const reservedJsonNames = new Set([
    ...generatedNames,
    "string",
    "number",
    "boolean",
    "null",
    "true",
    "false",
    "any",
    "unknown",
    "never",
    "void",
    "undefined",
    "symbol",
    "bigint",
    "object",
    "Schema",
    "ClientOptions",
    "FieldUpdate",
    "DecimalUpdate",
    "Where",
    "DateTime",
    "JsonInput",
    "Invalid",
    "class",
    "interface",
    "enum",
    "function",
    "const",
    "let",
    "var",
    "export",
    "import",
    "default",
    "extends",
    "implements",
    "new",
    "return",
    "this",
    "super",
    "typeof",
    "instanceof",
    "in",
    "public",
    "private",
    "protected",
    "static",
    "await",
    "yield",
    "break",
    "case",
    "catch",
    "continue",
    "debugger",
    "delete",
    "do",
    "else",
    "finally",
    "for",
    "if",
    "switch",
    "throw",
    "try",
    "while",
    "with",
    "Virtuals",
    "Models",
    "DistributiveOmit",
    "OneOf",
    "AtLeastOne",
    "Record",
    "Partial",
    "Pick",
    "Omit",
    "Required",
    "Exclude",
    "PropertyKey",
    "Uint8Array",
  ]);
  for (const name of Object.keys(jsonTypes)) {
    if (reservedJsonNames.has(name)) {
      error("JSON type name conflicts with generated types: " + name);
    }
  }
  const tables: Record<string, Table> = Object.create(null);
  const scalar = new Set(["int", "bigint", "number", "decimal", "string", "text", "boolean", "datetime", "json", "bytes"]);
  const mapName = (a: Attribute | undefined, token?: Token) => {
    if (!a) {
      return undefined;
    }
    if (a.args.length !== 1 || typeof a.args[0] !== "string" || !a.args[0] || a.args[0].includes("\0") || Object.keys(a.options).length) {
      error(`@${token ? "" : "@"}map requires one non-empty string`, token);
    }
    return a.args[0] as string;
  };
  const get = (f: Field, n: string) => {
    return f.attrs.find((a) => {
      return a.name === n;
    });
  };
  const reserved = new Set(["__proto__", "constructor", "prototype", "AND", "OR", "NOT", "_count"]);
  for (const m of models) {
    const attributes = new Set<string>();
    for (const a of m.attrs) {
      const identity = ["unique", "index"].includes(a.name) ? a.name + JSON.stringify(a.args) : a.name;
      if (attributes.has(identity)) {
        error(`Duplicate @@${a.name}`);
      }
      attributes.add(identity);
    }
    if (tables[m.name] || reserved.has(m.name) || m.name === "morph" || m.name.startsWith("$")) {
      error(`Invalid or duplicate model ${m.name}`);
    }
    if (
      models.some((other) => {
        return other !== m && internalModelKey(other) === internalModelKey(m);
      })
    ) {
      error("Client model name collision");
    }
    const t: Table = {
      name: m.name,
      columns: Object.create(null),
      relations: Object.create(null),
      primary: "",
      unique: [],
      indexes: [],
    };
    const tableMap = mapName(
      m.attrs.find((a) => {
        return a.name === "map";
      }),
    );
    if (tableMap) {
      t.map = tableMap;
    }
    if (m.comment) {
      t.comment = m.comment;
    }
    if (prefix) {
      t.prefix = prefix;
    }
    tables[m.name] = t;
    const seen = new Set<string>();
    for (const f of m.fields) {
      if (seen.has(f.name) || reserved.has(f.name) || f.name.startsWith("$") || f.name.startsWith("__orm_")) {
        error(`Invalid or duplicate field ${f.name}`, f.token);
      }
      seen.add(f.name);
      for (const a of f.attrs) {
        if (!["id", "auto", "unique", "via", "relation", "updatedAt", "map"].includes(a.name)) {
          error(`Unsupported @${a.name}`, f.token);
        }
      }
      for (const a of f.attrs.filter((a) => {
        return ["id", "auto", "unique", "updatedAt"].includes(a.name);
      })) {
        if (a.args.length || Object.keys(a.options).length) {
          error(`@${a.name} takes no arguments`, f.token);
        }
      }
      if (!scalar.has(f.type)) {
        continue;
      }
      if (f.many || get(f, "via") || get(f, "relation")) {
        error("Scalar fields cannot be relations or arrays", f.token);
      }
      const col: Column = {
        name: f.name,
        type: f.type as Scalar,
        nullable: f.nullable,
        primary: !!get(f, "id"),
        auto: !!get(f, "auto"),
        unique: !!get(f, "unique"),
        enum: f.enum,
        ...(f.dateStorage ? { dateStorage: f.dateStorage } : {}),
        maxLength: f.maxLength,
        ...(f.precision !== undefined ? { precision: f.precision, scale: f.scale } : {}),
        ...(get(f, "updatedAt") ? { updatedAt: true } : {}),
        ...(get(f, "map") ? { map: mapName(get(f, "map"), f.token) } : {}),
        ...(f.comment ? { comment: f.comment } : {}),
        ...(f.json ? { json: { root: f.json, definitions: jsonTypes } } : {}),
      };
      if (col.updatedAt && (col.type !== "datetime" || f.default !== undefined || col.primary || col.unique)) {
        error("@updatedAt requires a datetime field without default, @id or @unique", f.token);
      }
      if (f.default !== undefined) {
        col.default = f.default;
      } else if (f.nullable) {
        col.default = null;
      }
      if (col.type === "json" && (col.primary || col.unique || col.auto || (col.default !== undefined && col.default !== null))) {
        error("JSON does not support keys or non-null defaults", f.token);
      }
      if (col.type === "bytes" && (col.primary || col.unique)) {
        error("Bytes fields cannot be keys", f.token);
      }
      if (col.type === "text" && (col.primary || col.unique)) {
        error("Text fields cannot be keys", f.token);
      }
      if (col.primary) {
        if (t.primary || col.nullable) {
          error("Exactly one non-null primary key required", f.token);
        }
        t.primary = f.name;
      }
      if (col.auto && (!col.primary || !["int", "bigint"].includes(col.type) || col.default !== undefined)) {
        error("@auto requires int or bigint @id without default", f.token);
      }
      if (col.default !== undefined) {
        const d = col.default;
        if (d && typeof d === "object") {
          if ((d.fn === "now" && col.type !== "datetime") || (d.fn === "uuid" && col.type !== "string")) {
            error("Default function type mismatch", f.token);
          }
        } else if (invalidDefault(col, d)) {
          error("Invalid default value", f.token);
        }
      }
      if (col.maxLength && ((typeof col.default === "string" && [...col.default].length > col.maxLength) || (col.default && typeof col.default === "object" && col.default.fn === "uuid" && col.maxLength < 36))) {
        error("Default exceeds string length", f.token);
      }
      t.columns[f.name] = col;
    }
    if (
      m.attrs.some((a) => {
        return a.name === "id";
      })
    ) {
      if (t.primary) {
        error(`Model ${m.name} cannot combine @id with @@id`);
      }
      t.primaryKey = [];
    } else if (!t.primary) {
      error(`Model ${m.name} needs one scalar @id or @@id`);
    }
  }
  const morphs: {
    table: Table;
    relation: Relation;
    owners: string[];
    fields: Field[];
    token: Token;
  }[] = [];
  for (const m of models) {
    for (const f of m.fields.filter((f) => {
      return !scalar.has(f.type);
    })) {
      const t = tables[m.name];
      // Polymorphic owner: register the relation and defer column type validation until all owners are known.
      if (f.type === "morph") {
        if (f.nullable || f.many) {
          error("morph field must be required and singular", f.token);
        }
        if (f.default !== undefined) {
          error("morph field cannot have a default", f.token);
        }
        if (f.attrs.length) {
          error("morph fields take no attributes", f.token);
        }
        const [discriminator, id] = f.morph!.length ? f.morph! : [`${f.name}Type`, `${f.name}Id`];
        if (f.morph!.length) {
          const d = t.columns[discriminator];
          const i = t.columns[id];
          if (!d || !i) {
            error(`morph requires existing columns ${discriminator} and ${id}`, f.token);
          }
          if (d.type !== "string" || d.nullable) {
            error("morph discriminator must be a non-null string column", f.token);
          }
          if (i.nullable) {
            error("morph id column must be non-null", f.token);
          }
          if (d.primary || d.auto || d.unique || i.primary || i.auto || i.unique) {
            error("morph columns cannot be keys", f.token);
          }
        }
        if (
          Object.values(t.relations).some((r) => {
            return r.owner && !r.many && r.source === id;
          })
        ) {
          error(`Column ${id} cannot be owned by multiple relations`, f.token);
        }
        if (
          Object.values(t.relations).some((r) => {
            return r.polymorphic && r.discriminator === discriminator;
          })
        ) {
          error(`Column ${discriminator} cannot serve multiple morph fields`, f.token);
        }
        t.relations[f.name] = {
          name: f.name,
          target: "",
          many: false,
          nullable: false,
          owner: true,
          source: id,
          foreign: "",
          polymorphic: true,
          discriminator,
        };
        morphs.push({
          table: t,
          relation: t.relations[f.name],
          owners: [],
          fields: m.fields,
          token: f.token,
        });
        continue;
      }
      const target = tables[f.type];
      if (f.type === "Date") {
        error("The datetime type is spelled datetime", f.token);
      }
      if (!target) {
        error(`Unknown model ${f.type}`, f.token);
      }
      if (!get(f, "via") && (target.primaryKey || (f.many && t.primaryKey))) {
        error("Relations cannot reference a model with a composite @@id", f.token);
      }
      if (f.default !== undefined || get(f, "auto") || get(f, "id") || get(f, "map") || get(f, "updatedAt")) {
        error("Invalid relation attribute/default", f.token);
      }
      if (get(f, "via")) {
        continue;
      }
      if (f.many) {
        if (f.nullable || get(f, "unique") || get(f, "relation")) {
          error("Invalid many-to-many options", f.token);
        }
        if (tables[`_${m.name}_${f.name}`]) {
          error("Junction table name collision", f.token);
        }
        const junction = `${prefix}_${m.name}_${f.name}`;
        t.relations[f.name] = {
          name: f.name,
          target: f.type,
          many: true,
          nullable: false,
          owner: true,
          source: t.primary,
          foreign: target.primary,
          junction,
          junctionSource: "sourceId",
          junctionTarget: "targetId",
        };
        continue;
      }
      const a = get(f, "relation");
      // A foreign key has exactly one column, so the option name is singular.
      if (
        a?.args.length ||
        Object.keys(a?.options ?? {}).some((k) => {
          return !["field", "onDelete", "onUpdate"].includes(k);
        })
      ) {
        error("@relation supports field, onDelete and onUpdate", f.token);
      }
      const actions: Pick<Relation, "onDelete" | "onUpdate"> = {};
      for (const key of ["onDelete", "onUpdate"] as const) {
        const action = a?.options[key];
        if (action === undefined) {
          continue;
        }
        if (!["Cascade", "Restrict", "NoAction", "SetNull"].includes(action)) {
          error(`${key} must be Cascade, Restrict, NoAction or SetNull`, f.token);
        }
        if (action === "SetNull" && !f.nullable) {
          error(`${key}: SetNull requires an optional relation`, f.token);
        }
        actions[key] = action;
      }
      const fk: string = a?.options.field ?? `${f.name}${target.primary[0].toUpperCase()}${target.primary.slice(1)}`;
      if (typeof fk !== "string") {
        error("field must name one scalar column", f.token);
      }
      const targetCol = target.columns[target.primary];
      if (a?.options.field) {
        const col = t.columns[fk];
        if (
          !col ||
          col.type !== targetCol.type ||
          col.maxLength !== targetCol.maxLength ||
          col.precision !== targetCol.precision ||
          col.scale !== targetCol.scale ||
          (col.dateStorage ?? "string") !== (targetCol.dateStorage ?? "string") ||
          col.nullable !== f.nullable ||
          col.primary ||
          col.auto ||
          col.enum
        ) {
          error("Foreign key column type/nullability mismatch", f.token);
        }
        if (get(f, "unique")) {
          col.unique = true;
        }
      } else {
        if (
          m.fields.some((x) => {
            return x.name === fk;
          }) ||
          t.columns[fk]
        ) {
          error(`Generated field ${fk} collides; bind with @relation(field: ${fk})`, f.token);
        }
        t.columns[fk] = {
          name: fk,
          type: targetCol.type,
          maxLength: targetCol.maxLength,
          ...(targetCol.dateStorage ? { dateStorage: targetCol.dateStorage } : {}),
          ...(targetCol.precision !== undefined ? { precision: targetCol.precision, scale: targetCol.scale } : {}),
          nullable: f.nullable,
          primary: false,
          auto: false,
          unique: !!get(f, "unique"),
          ...(f.nullable ? { default: null } : {}),
          ...(f.comment ? { comment: f.comment } : {}),
        };
      }
      if (
        Object.values(t.relations).some((r) => {
          return r.owner && !r.many && r.source === fk;
        })
      ) {
        error("Foreign key cannot be owned by multiple relations", f.token);
      }
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
  }
  for (const m of models) {
    for (const f of m.fields) {
      const via = get(f, "via");
      if (!via) {
        continue;
      }
      if (via.args.length !== 1 || typeof via.args[0] !== "string" || Object.keys(via.options).length || f.attrs.length !== 1) {
        error("@via requires one target relation name", f.token);
      }
      const t = tables[m.name];
      const target = tables[f.type];
      const original = target?.relations[via.args[0]];
      if (!original || !original.owner || (original.target !== m.name && !original.polymorphic)) {
        error("Invalid inverse relation target", f.token);
      }
      // Polymorphic inverse: owners converge here; column types and the discriminator enum are validated during finalization.
      if (original.polymorphic) {
        if (!f.many || f.nullable) {
          error("Polymorphic inverse must be a required array", f.token);
        }
        if (t.primaryKey || !t.primary) {
          error("Polymorphic owners must have a single-column primary key", f.token);
        }
        if (
          Object.values(t.relations).some((r) => {
            return r.polymorphic && r.discriminatorValue === m.name && r.foreign === original.source;
          })
        ) {
          error("Duplicate inverse relation", f.token);
        }
        t.relations[f.name] = {
          name: f.name,
          target: f.type,
          many: true,
          nullable: false,
          owner: false,
          source: t.primary,
          foreign: original.source,
          polymorphic: true,
          discriminator: original.discriminator,
          discriminatorValue: m.name,
        };
        morphs
          .find((x) => {
            return x.relation === original;
          })!
          .owners.push(m.name);
        continue;
      }
      if (original.junction) {
        if (!f.many || f.nullable) {
          error("Inverse many-to-many must be an array", f.token);
        }
      } else {
        const unique = target.columns[original.source].unique;
        if (f.many === unique || (!f.many && !f.nullable) || (f.many && f.nullable)) {
          error("Inverse cardinality must match foreign key uniqueness; single inverse must be optional", f.token);
        }
      }
      if (
        Object.values(t.relations).some((r) => {
          return !r.owner && r.target === f.type && r.source === original.foreign && r.foreign === original.source && r.junction === original.junction;
        })
      ) {
        error("Duplicate inverse relation", f.token);
      }
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
  }
  // Finalize polymorphic relations: add implicit columns and validate matching owner key types and a closed discriminator enum.
  for (const morph of morphs) {
    if (!morph.owners.length) {
      error(`morph ${morph.relation.name} requires at least one inverse @via`, morph.token);
    }
    // Normalize once as JSON text so owners with the same key shape compare equal even when
    // `dateStorage` was omitted. The shape is parsed back when an implicit morph column is created.
    const keyShape = (column: Column) => {
      return JSON.stringify({
        type: column.type,
        maxLength: column.maxLength,
        precision: column.precision,
        scale: column.scale,
        dateStorage: column.type === "datetime" ? (column.dateStorage ?? "string") : undefined,
      });
    };
    const ownerShape = (name: string) => {
      const owner = tables[name];
      return keyShape(owner.columns[owner.primary]);
    };
    const shape = ownerShape(morph.owners[0]);
    for (const name of morph.owners) {
      if (ownerShape(name) !== shape) {
        error(`morph ${morph.relation.name} owners must share one primary key type`, morph.token);
      }
    }
    const checkName = (name: string) => {
      if (
        morph.table.columns[name] ||
        morph.fields.some((x) => {
          return x.name === name;
        })
      ) {
        error(`Generated morph column ${name} collides; bind both columns explicitly`, morph.token);
      }
    };
    const discriminatorName = morph.relation.discriminator!;
    let discriminator = morph.table.columns[discriminatorName];
    const idColumn = morph.table.columns[morph.relation.source];
    if (idColumn && discriminator) {
      if (keyShape(idColumn) !== shape) {
        error(`morph ${morph.relation.name} id column does not match the owners' primary key type`, morph.token);
      }
    } else {
      if (idColumn || discriminator) {
        error(`morph ${morph.relation.name} requires both columns explicit or both implicit`, morph.token);
      }
      checkName(discriminatorName);
      checkName(morph.relation.source);
      const { type, maxLength, precision, scale, dateStorage } = JSON.parse(shape) as {
        type: Scalar;
        maxLength?: number;
        precision?: number;
        scale?: number;
        dateStorage?: Column["dateStorage"];
      };
      morph.table.columns[discriminatorName] = {
        name: discriminatorName,
        type: "string",
        maxLength: defaultStringLength,
        nullable: false,
        primary: false,
        auto: false,
        unique: false,
      };
      morph.table.columns[morph.relation.source] = {
        name: morph.relation.source,
        type,
        ...(maxLength ? { maxLength } : {}),
        ...(precision !== undefined ? { precision, scale } : {}),
        ...(dateStorage ? { dateStorage } : {}),
        nullable: false,
        primary: false,
        auto: false,
        unique: false,
      };
      discriminator = morph.table.columns[discriminatorName];
    }
    if (discriminator.enum) {
      for (const name of morph.owners) {
        if (!discriminator.enum.includes(name)) {
          error(`morph discriminator enum does not cover owner ${name}`, morph.token);
        }
      }
      for (const value of discriminator.enum) {
        if (!morph.owners.includes(value)) {
          error(`morph discriminator enum value ${value} has no inverse @via`, morph.token);
        }
      }
    }
  }
  /** @@id, @@unique and @@index accept bare field names only; bracket syntax is rejected. */
  const fieldKeys = (args: any[]): string[] => {
    if (
      args.some((k) => {
        return Array.isArray(k);
      })
    ) {
      error("Field lists take bare names, not brackets");
    }
    const keys = args.filter((k) => {
      return typeof k === "string";
    });
    if (keys.length !== args.length) {
      error("Invalid index fields");
    }
    return keys;
  };
  for (const m of models) {
    for (const a of m.attrs) {
      if (a.name === "map") {
        continue;
      }
      if (a.name === "id") {
        const table = tables[m.name];
        const keys = fieldKeys(a.args).map((k) => {
          return table.relations[k]?.source ?? k;
        });
        if (
          Object.keys(a.options).length ||
          keys.length < 2 ||
          new Set(keys).size !== keys.length ||
          keys.some((k) => {
            const c = table.columns[k];
            return !c || c.nullable || c.type === "json" || c.type === "bytes" || c.type === "text";
          })
        ) {
          error("@@id requires two or more distinct non-null scalar fields; use @id for one");
        }
        table.primaryKey = keys;
        continue;
      }
      if (a.name === "softDelete") {
        const table = tables[m.name];
        if (a.args.length > 1 || Object.keys(a.options).length) {
          error("@@softDelete takes at most one field name");
        }
        // Default to deletedAt when omitted; add a nullable datetime column if the field is not declared.
        const field = a.args[0] ?? "deletedAt";
        if (typeof field !== "string" || (a.args.length && !table.columns[field])) {
          error("@@softDelete requires one nullable datetime field");
        }
        if (!table.columns[field]) {
          table.columns[field] = {
            name: field,
            type: "datetime",
            nullable: true,
            primary: false,
            auto: false,
            unique: false,
            default: null,
          };
        }
        const column = table.columns[field];
        if (column.type !== "datetime" || column.default !== null || !column.nullable || column.primary || column.unique || table.softDelete) {
          error("@@softDelete requires one nullable datetime field");
        }
        table.softDelete = field;
        continue;
      }

      if (!["unique", "index"].includes(a.name) || Object.keys(a.options).length || !a.args.length) {
        error(`Unsupported @@${a.name}; use @@id, @@unique, @@index, @@map or @@softDelete`);
      }
      const keys = fieldKeys(a.args).map((k) => {
        return tables[m.name].relations[k]?.source ?? k;
      });
      if (
        keys.some((k) => {
          return !tables[m.name].columns[k];
        }) ||
        new Set(keys).size !== keys.length
      ) {
        error("Invalid index fields");
      }
      for (const [type, label] of [
        ["bytes", "Bytes"],
        ["text", "Text"],
      ]) {
        if (
          keys.some((k) => {
            return tables[m.name].columns[k].type === type;
          })
        ) {
          error(label + " fields cannot be indexed");
        }
      }
      tables[m.name][a.name === "unique" ? "unique" : "indexes"].push(keys);
    }
  }
  const inspect = (shape: JsonShape, seen = new Set<string>()): void => {
    if (shape.kind === "ref") {
      if (!jsonTypes[shape.name]) {
        error("Unknown JSON type " + shape.name);
      }
      if (!seen.has(shape.name)) {
        const next = new Set(seen);
        next.add(shape.name);
        inspect(jsonTypes[shape.name], next);
      }
    } else if (shape.kind === "object") {
      for (const field of Object.values(shape.fields)) {
        inspect(field.shape, seen);
      }
    } else if (shape.kind === "array") {
      inspect(shape.element, seen);
    } else if (shape.kind === "record") {
      inspect(shape.value, seen);
    } else if (shape.kind === "union") {
      shape.items.forEach((item) => {
        return inspect(item, seen);
      });
    }
  };
  Object.values(jsonTypes).forEach((shape) => {
    return inspect(shape);
  });
  for (const table of Object.values(tables)) {
    for (const column of Object.values(table.columns)) {
      if (column.json) {
        inspect(column.json.root);
      }
    }
    for (const keys of [...table.unique, ...table.indexes]) {
      if (
        keys.some((key) => {
          return table.columns[key].type === "json";
        })
      ) {
        error("JSON index requires explicit database support");
      }
    }
  }
  const physicalTables = new Set<string>([internalHistoryTableName(prefix)]);
  const ignores = internalIgnoredTable(ignore);
  const reserveTable = (name: string) => {
    if (physicalTables.has(name)) {
      error("Physical table name collision: " + name);
    }
    if (ignores(name)) {
      error("Table " + name + " matches an ignore pattern");
    }
    physicalTables.add(name);
  };
  for (const table of Object.values(tables)) {
    reserveTable(internalTableName(table));
    const physicalColumns = new Set<string>();
    for (const column of Object.values(table.columns)) {
      const name = internalColumnName(column);
      if (physicalColumns.has(name)) {
        error("Physical column name collision: " + table.name + "." + name);
      }
      physicalColumns.add(name);
    }
  }
  for (const table of Object.values(tables)) {
    for (const relation of Object.values(table.relations)) {
      if (relation.owner && relation.junction) {
        reserveTable(relation.junction);
      }
    }
  }
  return { version: 1, tables, ...(Object.keys(jsonTypes).length ? { jsonTypes } : {}), ...(ignore.length ? { ignore } : {}), ...(prefix ? { prefix } : {}) };
}
