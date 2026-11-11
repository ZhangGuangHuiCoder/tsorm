import type { DeletedMode } from "../query/visibility.js";
import type { Spec, Where, ScalarFilter, QueryableRow, Simplify } from "./types.js";
type Numeric<R> = {
  [K in keyof R]: NonNullable<R[K]> extends number | bigint ? K : never;
}[keyof R];
type Comparable<R> = keyof R;
type DecimalFields<S extends Spec, K extends keyof S> = S[K] extends {
  decimalFields: infer D extends string;
}
  ? Extract<D, keyof QueryableRow<S, K>>
  : never;
type BigintFields<S extends Spec, K extends keyof S> = Extract<S[K]["bigintFields"], keyof QueryableRow<S, K>>;
type NumericFields<S extends Spec, K extends keyof S> = Numeric<QueryableRow<S, K>> | DecimalFields<S, K> | BigintFields<S, K>;
type Fields<R, K extends keyof R = keyof R> = Partial<Record<K, boolean>>;
export type AggregateArgs<S extends Spec, K extends keyof S> = {
  where?: Where<S, K>;
  deleted?: DeletedMode;
  orderBy?: Partial<Record<keyof QueryableRow<S, K>, "asc" | "desc">> | Partial<Record<keyof QueryableRow<S, K>, "asc" | "desc">>[];
  skip?: number;
  take?: number;
  _count?: true | (Fields<QueryableRow<S, K>> & { _all?: boolean });
  _sum?: Fields<QueryableRow<S, K>, NumericFields<S, K>>;
  _avg?: Fields<QueryableRow<S, K>, NumericFields<S, K>>;
  _min?: Fields<QueryableRow<S, K>, Comparable<QueryableRow<S, K>>>;
  _max?: Fields<QueryableRow<S, K>, Comparable<QueryableRow<S, K>>>;
};
type Selected<P, V> = Simplify<{ [F in keyof P as P[F] extends false | undefined ? never : F]: V }>;
/** Deferred while `A` is unresolved, so method hovers print `AggregateResult<...>`; flat once called. */
export type AggregateResult<R, A, D extends keyof R = never> = A extends unknown
  ? Simplify<{
      [Op in keyof A as Op extends "_count" | "_sum" | "_avg" | "_min" | "_max" ? Op : never]: Op extends "_count"
        ? A[Op] extends true
          ? number
          : Selected<A[Op], number>
        : Op extends "_avg"
          ? Simplify<{
              [F in keyof A[Op] as A[Op][F] extends false | undefined ? never : F]: F extends keyof R ? (F extends D ? string | null : number | null) : never;
            }>
          : Simplify<{
              [F in keyof A[Op] as A[Op][F] extends false | undefined ? never : F]: F extends keyof R ? R[F] | null : never;
            }>;
    }>
  : never;
type HavingOperand<R, F extends keyof R, D extends keyof R> = F extends D ? string | number | (null extends R[F] ? null : never) : R[F];
type Having<R, D extends keyof R = never> = {
  [F in keyof R]?:
    | HavingOperand<R, F, D>
    | (ScalarFilter<HavingOperand<R, F, D>> & {
        _count?: ScalarFilter<number>;
        _min?: ScalarFilter<HavingOperand<R, F, D>>;
        _max?: ScalarFilter<HavingOperand<R, F, D>>;
      } & (F extends Numeric<R> | D
          ? {
              _sum?: ScalarFilter<F extends D ? string | number : NonNullable<R[F]> extends bigint ? bigint | number : number>;
              _avg?: ScalarFilter<F extends D ? string | number : number>;
            }
          : { _sum?: never; _avg?: never }));
} & { AND?: Having<R, D>[]; OR?: Having<R, D>[]; NOT?: Having<R, D> };
export type GroupByArgs<S extends Spec, K extends keyof S> = Omit<AggregateArgs<S, K>, "orderBy"> & {
  by: readonly (keyof QueryableRow<S, K>)[];
  having?: Having<QueryableRow<S, K>, DecimalFields<S, K> | BigintFields<S, K>>;
  orderBy?: GroupOrder<QueryableRow<S, K>, DecimalFields<S, K> | BigintFields<S, K>> | GroupOrder<QueryableRow<S, K>, DecimalFields<S, K> | BigintFields<S, K>>[];
};
type GroupOrder<R, D extends keyof R = never> = Partial<Record<keyof R, "asc" | "desc">> & {
  _count?: Partial<Record<keyof R | "_all", "asc" | "desc">>;
  _sum?: Partial<Record<Numeric<R> | D, "asc" | "desc">>;
  _avg?: Partial<Record<Numeric<R> | D, "asc" | "desc">>;
  _min?: Partial<Record<Comparable<R>, "asc" | "desc">>;
  _max?: Partial<Record<Comparable<R>, "asc" | "desc">>;
};
export type GroupByResult<R, A extends { by: readonly PropertyKey[] }, D extends keyof R = never> = A extends unknown ? Simplify<Pick<R, A["by"][number] & keyof R> & AggregateResult<R, A, D>> : never;
