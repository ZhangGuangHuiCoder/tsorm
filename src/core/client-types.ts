import type { DeletedMode } from "../query/predicates.js";
import type { RawClient } from "./raw.js";
import type { AggregateArgs, AggregateResult, GroupByArgs, GroupByResult } from "./analytics.js";
import type { NumericUpdate } from "../query/predicates.js";
import { internalModelTable, type Schema } from "../schema/model.js";
import { fail, checkObject } from "../shared/index.js";
export type FieldUpdate<T> =
  | T
  | (NonNullable<T> extends number
      ? NumericUpdate<T>
      : // bigint inputs are typed `bigint | number`, so test for the bigint member, not the whole union.
        bigint extends NonNullable<T>
        ? NumericUpdate<T, bigint | string | number>
        : { set: T });
/**
 * decimal 字段的更新输入：一个值、`{ set }` 或使用 decimal 操作数的算术更新。
 * Update input of a decimal field: a value, `{ set }` or arithmetic with decimal operands.
 */
export type DecimalUpdate<T extends string | number | null> = T | NumericUpdate<T, string | number>;
import type { Capabilities, TransactionOptions } from "./adapter.js";
export type Spec = Record<
  string,
  {
    row: Record<string, any>;
    dateFields?: string;
    decimalFields?: string;
    bigintFields?: string;
    virtualFields?: string;
    /** Client-wide omit defaults. */
    omitted?: Record<string, any>;
    jsonFields?: string;
    create: Record<string, any>;
    update: Record<string, any>;
    scalarCreate: Record<string, any>;
    scalarUpdate: Record<string, any>;
    unique: Record<string, any>;
    relations: Record<
      string,
      {
        target: string;
        many: boolean;
        nullable: boolean;
      }
    >;
  }
>;
type Target<S extends Spec, K extends keyof S, R extends keyof S[K]["relations"]> = S[K]["relations"][R]["target"] & keyof S;
/** Operators every scalar field accepts. */
type EqualityFilter<T> = {
  equals?: T;
  in?: T[];
  notIn?: T[];
  not?: T | ScalarFilter<T>;
};
/**
 * 数字、大整数和日期支持的操作符。
 * Operators of numbers, bigints and dates.
 */
export type ComparableFilter<T> = EqualityFilter<T> & {
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
};
/**
 * 字符串（包括枚举）支持的操作符。
 * Operators of strings, including enums.
 */
export type StringFilter<T> = ComparableFilter<T> & {
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  mode?: "default" | "insensitive";
};
/**
 * 标量字段的过滤操作符。解析为命名过滤器，使悬停提示显示
 * `StringFilter<string>` 或 `ComparableFilter<number>`，而非一串条件类型。
 * Filter operators of a scalar field. Resolves to a named filter, so hovers read
 * `StringFilter<string>` or `ComparableFilter<number>` rather than a list of conditionals.
 */
export type ScalarFilter<T> = [NonNullable<T>] extends [string] ? StringFilter<T> : [NonNullable<T>] extends [string | number | bigint | Date] ? ComparableFilter<T> : EqualityFilter<T>;
type InputField<S extends Spec, K extends keyof S, F extends keyof S[K]["row"]> = F extends S[K]["dateFields"]
  ? Date | (null extends S[K]["row"][F] ? null : never)
  : F extends S[K]["bigintFields"]
    ? bigint | string | number | (null extends S[K]["row"][F] ? null : never)
    : S[K]["row"][F];
type PhysicalRow<S extends Spec, K extends keyof S> = Omit<S[K]["row"], S[K] extends { virtualFields: infer V extends string } ? V : never>;
export type QueryableRow<S extends Spec, K extends keyof S> = Omit<PhysicalRow<S, K>, S[K] extends { jsonFields: infer J extends string } ? J : never>;
/**
 * 通过对象键和数组索引定位并过滤 JSON 字段内的值。
 * Filter on a value inside a JSON field, addressed by object keys and array indexes.
 */
export type JsonFilter = {
  path: readonly (string | number)[];
  equals?: string | number | boolean | null;
  not?: string | number | boolean | null;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  string_contains?: string;
  string_starts_with?: string;
  string_ends_with?: string;
};
type JsonField<S extends Spec, K extends keyof S> = S[K] extends {
  jsonFields: infer J extends string;
}
  ? J
  : never;
type VirtualField<S extends Spec, K extends keyof S> = S[K] extends {
  virtualFields: infer V extends string;
}
  ? V
  : never;
/**
 * 对多关系过滤：部分、没有或每条关联记录匹配。
 * Filter on a to-many relation: some, none or every related record matches.
 */
export type ListRelationFilter<W> = { some?: W; none?: W; every?: W };
/**
 * 对一关系过滤：关联记录匹配或不匹配；`null` 表示无关联记录。
 * Filter on a to-one relation: the related record matches, or not; `null` tests for none.
 */
export type RelationFilter<W> = { is?: W | null; isNot?: W | null };
/**
 * 模型过滤器。标量和 JSON 字段来自基于行的同一映射类型，
 * 因此保留 schema 顺序，无 JSON 字段的模型也不会产生空的 `& {}` 成员。
 * Filter of a model. Scalar and JSON fields come from one mapped type over the row, so they
 * keep schema order and models without JSON fields get no empty `& {}` member.
 */
export type Where<S extends Spec, K extends keyof S> = {
  [F in keyof S[K]["row"] as F extends VirtualField<S, K> ? never : F]?: F extends JsonField<S, K> ? JsonFilter : InputField<S, K, F> | ScalarFilter<InputField<S, K, F>>;
} & {
  [R in keyof S[K]["relations"]]?: S[K]["relations"][R]["many"] extends true ? ListRelationFilter<Where<S, Target<S, K, R>>> : RelationFilter<Where<S, Target<S, K, R>>>;
} & {
  AND?: Where<S, K>[];
  OR?: Where<S, K>[];
  NOT?: Where<S, K>;
};
export type Select<S extends Spec, K extends keyof S> = {
  [F in keyof S[K]["row"]]?: boolean;
} & Include<S, K>;
type ManyRelations<S extends Spec, K extends keyof S> = {
  [R in keyof S[K]["relations"]]: S[K]["relations"][R]["many"] extends true ? R : never;
}[keyof S[K]["relations"]];
type CountSelect<S extends Spec, K extends keyof S> = {
  [R in ManyRelations<S, K>]?: boolean | { where?: Where<S, Target<S, K, R>> };
};
type Include<S extends Spec, K extends keyof S> = {
  _count?: boolean | { select: CountSelect<S, K> };
} & {
  [R in keyof S[K]["relations"]]?: boolean | Query<S, Target<S, K, R>>;
};
/**
 * 除非 `nulls` 显式指定位置，否则 NULL 按最小值排序。
 * NULL sorts as the smallest value unless `nulls` places it explicitly.
 */
export type SortOrder = "asc" | "desc" | { sort: "asc" | "desc"; nulls?: "first" | "last" };
/**
 * 按字段、关联记录的字段或关联记录数量排序。
 * Sort by fields, by fields of a related record, or by the number of related records.
 */
export type OrderBy<S extends Spec, K extends keyof S> = {
  [F in keyof S[K]["row"] as F extends VirtualField<S, K> | JsonField<S, K> ? never : F]?: SortOrder;
} & {
  [R in keyof S[K]["relations"]]?: S[K]["relations"][R]["many"] extends true ? { _count: "asc" | "desc" } : OrderBy<S, Target<S, K, R>>;
};
export type Query<S extends Spec, K extends keyof S> = {
  where?: Where<S, K>;
  deleted?: DeletedMode;
  orderBy?: OrderBy<S, K> | OrderBy<S, K>[];
  skip?: number;
  take?: number;
  cursor?: S[K]["unique"];
  distinct?: keyof QueryableRow<S, K> | readonly (keyof QueryableRow<S, K>)[];
} & (
  | {
      select?: Select<S, K>;
      include?: never;
    }
  | {
      select?: never;
      include?: Include<S, K>;
      omit?: OmitFields<S, K>;
    }
);
/**
 * 将交叉类型和辅助映射类型展开为普通对象类型，使编辑器悬停显示
 * `{ id: number; email: string; ... }`，而不是构建结果所用的类型。
 * 同时移除对 `const` 查询参数进行映射时复制到字段上的 `readonly`。
 * Flattens intersections and helper mapped types into one plain object type, so editor hovers
 * show `{ id: number; email: string; ... }` instead of the types the result was built from.
 * Also drops the `readonly` that mapping over a `const` query argument would copy onto fields.
 */
export type Simplify<T> = { -readonly [K in keyof T]: T[K] } & {};
type RelValue<S extends Spec, K extends keyof S, R extends keyof S[K]["relations"], Q> = S[K]["relations"][R]["many"] extends true
  ? Payload<S, Target<S, K, R>, Q>[]
  : Payload<S, Target<S, K, R>, Q> | (S[K]["relations"][R]["nullable"] extends true ? null : never);
type CountResult<S extends Spec, K extends keyof S, Q> = Q extends true ? { [R in ManyRelations<S, K>]: number } : Q extends { select: infer P } ? { [R in keyof P as P[R] extends false | undefined ? never : R]: number } : never;
type Value<S extends Spec, K extends keyof S, F, Q> = F extends "_count" ? CountResult<S, K, Q> : F extends keyof S[K]["row"] ? S[K]["row"][F] : F extends keyof S[K]["relations"] ? RelValue<S, K, F, Q> : never;
type Projection<S extends Spec, K extends keyof S, P> = {
  [F in keyof P as P[F] extends false | undefined ? never : boolean extends P[F] ? never : F]: Value<S, K, F, P[F]>;
} & {
  [F in keyof P as boolean extends P[F] ? F : never]?: Value<S, K, F, P[F]>;
};
export type Payload<S extends Spec, K extends keyof S, Q> = Q extends {
  select: infer P;
}
  ? Simplify<Projection<S, K, P>>
  : Simplify<
      Omitted<S[K]["row"], MergeOmit<S[K]["omitted"], Q extends { omit: infer O } ? O : undefined>> &
        (Q extends {
          include: infer P;
        }
          ? Projection<S, K, P>
          : {})
    >;
type QueryBase<S extends Spec, K extends keyof S> = Pick<Query<S, K>, "where" | "orderBy" | "skip" | "take" | "cursor" | "distinct" | "deleted">;
export type OmitFields<S extends Spec, K extends keyof S> = Partial<Record<keyof S[K]["row"], boolean>>;
/**
 * `$extend({ omit })` 选项：按模型（lowerCamelCase）指定要省略的字段。
 * $extend({ omit }) option: per model (lowerCamelCase), fields to leave out.
 */
export type GlobalOmit<S extends Spec> = {
  [K in keyof S as Uncapitalize<K & string>]?: Partial<Record<keyof S[K]["row"], boolean>>;
};
/**
 * 没有客户端级 omit 时原样返回模型映射，使悬停提示保持简短。
 * Without a client-wide omit the model map is returned as is, keeping hovers short.
 */
export type WithOmit<S extends Spec, O> = [keyof O] extends [never]
  ? S
  : {
      [K in keyof S]: { [F in keyof S[K]]: F extends "omitted" ? unknown : S[K][F] } & {
        omitted: MergeOmit<S[K]["omitted"], Uncapitalize<K & string> extends keyof O ? Extract<O[Uncapitalize<K & string>], Record<string, any>> : undefined>;
      };
    };
/** The query's omit overrides the client-wide one field by field. */
type MergeOmit<D, O> = [D] extends [Record<string, any>] ? ([O] extends [undefined] ? D : Omit<D, keyof O> & O) : O;
/**
 * The row without the fields `O` omits: `true` drops a field, `false` keeps it, and a plain
 * `boolean` makes it optional. Mapping over `keyof R` (rather than using `Omit`) keeps the fields
 * in schema order; without omits the row is returned untouched.
 */
type Omitted<R, O> = [Extract<keyof O, keyof R>] extends [never]
  ? R
  : {
      [F in keyof R as F extends keyof O ? (O[F] extends true ? never : boolean extends O[F] ? never : F) : F]: R[F];
    } & {
      [F in keyof R as F extends keyof O ? (boolean extends O[F] ? F : never) : never]?: R[F];
    };
/**
 * 任何值都无法填充的槽位。在禁止某个选项的位置用它代替 `never`，
 * 这样编译错误会指出规则（`Invalid<"select cannot be combined with include">`），
 * 而不是仅提示该值不能赋给 `undefined`。
 * A slot that no value can fill. Used instead of `never` where an option is forbidden, because a
 * compiler error then names the rule (`Invalid<"select cannot be combined with include">`)
 * rather than saying the value is not assignable to `undefined`.
 */
export type Invalid<Message extends string> = { readonly [K in Message]: never };
/**
 * `select`, or `include` and `omit`. The `select` member is listed last on purpose: TypeScript
 * reports a failed union against its last member, so mixing them names the rule above.
 */
type ProjectionInput<S extends Spec, K extends keyof S, P, I, O = undefined> =
  | {
      select?: Invalid<"select cannot be combined with include or omit">;
      include: I & Include<S, K>;
      omit?: O & OmitFields<S, K>;
    }
  | {
      select?: Invalid<"select cannot be combined with include or omit">;
      include?: Invalid<"select cannot be combined with include or omit">;
      omit?: O & OmitFields<S, K>;
    }
  | {
      select: P & Select<S, K>;
      include?: Invalid<"select cannot be combined with include or omit">;
      omit?: Invalid<"select cannot be combined with include or omit">;
    };
/**
 * 查询返回的记录。`Simplify` 位于各分支内部，而非包裹整个条件类型：
 * 当 `P`、`I` 和 `O` 尚未解析时（方法自身的悬停提示），条件类型保持延迟，
 * 并显示为 `Result<...>`；具体调用时则展开为普通对象。
 * The record a query returns. `Simplify` sits inside the branches rather than around the whole
 * conditional: while `P`, `I` and `O` are still unresolved (a method's own hover) the conditional
 * stays deferred and prints as `Result<...>`; for a concrete call it flattens to a plain object.
 */
export type Result<S extends Spec, K extends keyof S, P, I, O = undefined> = [P] extends [undefined]
  ? [I] extends [undefined]
    ? Simplify<Omitted<S[K]["row"], MergeOmit<S[K]["omitted"], O>>>
    : Simplify<Omitted<S[K]["row"], MergeOmit<S[K]["omitted"], O>> & Projection<S, K, I>>
  : Simplify<Projection<S, K, P>>;
/**
 * `findMany`、`findFirst` 及其变体的参数。
 * Arguments of `findMany`, `findFirst` and their variants.
 */
export type FindArgs<S extends Spec, K extends keyof S, P, I, O> = QueryBase<S, K> & ProjectionInput<S, K, P, I, O>;
/** Arguments of `findUnique` and `findUniqueOrThrow`. */
type FindUniqueArgs<S extends Spec, K extends keyof S, P, I, O> = Omit<QueryBase<S, K>, "where"> & {
  where: S[K]["unique"];
} & ProjectionInput<S, K, P, I, O>;
/**
 * `create` 的参数。
 * Arguments of `create`.
 */
export type CreateArgs<S extends Spec, K extends keyof S, P, I, O> = {
  data: S[K]["create"];
} & ProjectionInput<S, K, P, I, O>;
/** Arguments of `update`. */
type UpdateArgs<S extends Spec, K extends keyof S, P, I, O> = {
  where: S[K]["unique"];
  data: S[K]["update"];
} & ProjectionInput<S, K, P, I, O>;
/** Arguments of `upsert`. */
type UpsertArgs<S extends Spec, K extends keyof S, P, I, O> = {
  where: S[K]["unique"];
  create: S[K]["create"];
  update: S[K]["update"];
} & ProjectionInput<S, K, P, I, O>;
/** Arguments of `delete`, `restore` and `forceDelete`. */
type UniqueArgs<S extends Spec, K extends keyof S, P, I, O> = {
  where: S[K]["unique"];
} & ProjectionInput<S, K, P, I, O>;
/** Arguments of `createManyAndReturn`. */
type CreateManyAndReturnArgs<S extends Spec, K extends keyof S, P, I, O> = {
  data: S[K]["scalarCreate"][];
  skipDuplicates?: boolean;
} & ProjectionInput<S, K, P, I, O>;
/** Arguments of `updateManyAndReturn`. */
type UpdateManyAndReturnArgs<S extends Spec, K extends keyof S, P, I, O> = {
  where: Where<S, K>;
  data: S[K]["scalarUpdate"];
} & ProjectionInput<S, K, P, I, O>;
interface ModelClient<S extends Spec, K extends keyof S> {
  findMany<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args?: FindArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>[]>;
  findManyAndCount<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(
    args?: FindArgs<S, K, P, I, O>,
  ): Promise<{ data: Result<S, K, P, I, O>[]; total: number }>;
  findFirst<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args?: FindArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O> | null>;
  findUnique<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: FindUniqueArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O> | null>;
  create<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: CreateArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  update<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: UpdateArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  delete<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: UniqueArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  upsert<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: UpsertArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  findUniqueOrThrow<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: FindUniqueArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  findFirstOrThrow<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args?: FindArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  aggregate<const A extends AggregateArgs<S, K>>(args: A & AggregateArgs<S, K>): Promise<AggregateResult<S[K]["row"], A, Extract<S[K]["decimalFields"] | S[K]["bigintFields"], keyof S[K]["row"]>>>;
  groupBy<const A extends GroupByArgs<S, K>>(args: A & GroupByArgs<S, K>): Promise<GroupByResult<S[K]["row"], A, Extract<S[K]["decimalFields"] | S[K]["bigintFields"], keyof S[K]["row"]>>[]>;
  restore<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: UniqueArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  restoreMany(args: { where: Where<S, K> }): Promise<{ count: number }>;
  forceDelete<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(args: UniqueArgs<S, K, P, I, O>): Promise<Result<S, K, P, I, O>>;
  forceDeleteMany(args: { where: Where<S, K> }): Promise<{ count: number }>;
  createMany(args: { data: S[K]["scalarCreate"][]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  createManyAndReturn<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(
    args: CreateManyAndReturnArgs<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>[]>;
  updateManyAndReturn<const P extends Select<S, K> | undefined = undefined, const I extends Include<S, K> | undefined = undefined, const O extends OmitFields<S, K> | undefined = undefined>(
    args: UpdateManyAndReturnArgs<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>[]>;
  updateMany(args: { where: Where<S, K>; data: S[K]["scalarUpdate"] }): Promise<{ count: number }>;
  deleteMany(args: { where: Where<S, K> }): Promise<{ count: number }>;
  count(args?: { where?: Where<S, K>; distinct?: keyof QueryableRow<S, K> | readonly (keyof QueryableRow<S, K>)[]; deleted?: DeletedMode }): Promise<number>;
}
export type TxClient<S extends Spec> = RawClient & {
  /** Delete every row of a model; `force` also removes rows hidden by soft delete. */
  $clear<K extends keyof S & string>(model: Uncapitalize<K>, options?: { force?: boolean }): Promise<{ count: number }>;
} & {
  [K in keyof S as Uncapitalize<K & string>]: ModelClient<S, K>;
};
export type Client<S extends Spec> = TxClient<S> & {
  $transaction<T>(fn: (tx: TxClient<S>) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** Extends a client with extra virtuals and omit layered on top of the current ones. The extended client shares the connection, transactions and close with the original. */
  $extend<const V2 extends Virtuals<S> = {}, const O2 extends GlobalOmit<WithVirtuals<S, V2>> = {}>(options?: { virtuals?: V2 & Virtuals<S>; omit?: O2 }): Client<WithOmit<WithVirtuals<S, V2>, O2>>;
  $capabilities: Readonly<Capabilities>;
  $close(): Promise<void>;
};

// ─── Virtual fields ────────────────────────────────────────────────────────
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
 * 将 `V` 的虚拟字段添加到各模型的行。没有虚拟字段的模型，以及
 * 完全无虚拟字段时的整个映射，都原样返回，使悬停保留普通生成类型名。
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
    const table = internalModelTable(schema, model);
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
