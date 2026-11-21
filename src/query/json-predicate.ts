import type { JsonContext } from "../core/adapter.js";
import { fail, allOf } from "../shared/index.js";

type Kind = "string" | "number";
type Guard = (kind: Kind, condition: () => string) => string;
/**
 * JSON 路径过滤的方言特定 SQL。每次调用 `type`、`text` 或 `number` 都会再次绑定路径，因此必须按 SQL 文本中的出现顺序调用。
 * The dialect-specific SQL of a JSON path filter. Every call of `type`, `text` or `number`
 * binds the path again, so they must be called in the order their SQL appears in the text.
 */
export interface JsonAccess {
  /** JSON type name of the value at the path. */
  type(): string;
  /** The value at the path as text. */
  text(): string;
  /** The value at the path as a number. */
  number(): string;
  /** SQL list of the type names that count as a string or a number. */
  types: Record<Kind, string>;
  /** SQL literal used when the value is absent or of the wrong type. */
  falsity: string;
  /** Equality with an already validated string, finite number, boolean or null. */
  equals(value: string | number | boolean | null, guard: Guard): string;
}
/**
 * 支持 JSON 路径的方言共享的 `$.a[0]."b"` 路径语法。
 * `$.a[0]."b"` path syntax shared by the dialects that support JSON paths.
 */
export const jsonPath = (path: (string | number)[]) => {
  return (
    "$" +
    path
      .map((p) => {
        return typeof p === "number" ? `[${p}]` : "." + JSON.stringify(p);
      })
      .join("")
  );
};
/**
 * 构建方言的 JSON 过滤器：操作符与校验共享，表达式由 `access` 提供。
 * Builds a dialect's JSON filter: operators and validation are shared, the expressions come from `access`.
 */
export function jsonPredicate(access: (col: string, path: (string | number)[], bind: (value: any) => string, falsity: string) => JsonAccess) {
  return (col: string, path: (string | number)[], value: Record<string, any>, params: any[], ctx: JsonContext): string => {
    const bind = (v: any) => {
      return ctx.bind(params, v);
    };
    const a = access(col, path, bind, ctx.falsity);
    const guard: Guard = (kind, condition) => {
      return `COALESCE(${a.type()} IN (${a.types[kind]}) AND ${condition()}, ${a.falsity})`;
    };
    const equals = (v: any): string => {
      if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
        fail("JSON equals accepts a string, number, boolean or null");
      }
      if (typeof v === "number" && !Number.isFinite(v)) {
        fail("JSON equals requires a finite number");
      }
      return a.equals(v, guard);
    };
    const pieces: string[] = [];
    for (const [op, v] of Object.entries(value)) {
      if (op === "path") {
        continue;
      }
      if (op === "equals") {
        pieces.push(equals(v));
      } else if (op === "not") {
        pieces.push(`NOT (${equals(v)})`);
      } else if (["gt", "gte", "lt", "lte"].includes(op)) {
        if (typeof v !== "number" || !Number.isFinite(v)) {
          fail(`JSON ${op} requires a finite number`);
        }
        pieces.push(
          guard("number", () => {
            return `${a.number()} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ${bind(v)}`;
          }),
        );
      } else {
        if (typeof v !== "string") {
          fail(`JSON ${op} requires a string`);
        }
        pieces.push(
          guard("string", () => {
            return `${a.text()} LIKE ${bind(ctx.pattern(op, v))} ESCAPE '!'`;
          }),
        );
      }
    }
    return allOf(pieces, ctx.truth);
  };
}
