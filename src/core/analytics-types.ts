import type { DeletedMode } from '../query/visibility.js';
import type { Spec, Where, ScalarFilter, QueryableRow } from './types.js';
type Numeric<R> = { [K in keyof R]: NonNullable<R[K]> extends number ? K : never }[keyof R];
type Comparable<R> = { [K in keyof R]: NonNullable<R[K]> extends boolean ? never : K }[keyof R];
type Fields<R, K extends keyof R = keyof R> = Partial<Record<K, boolean>>;
export type AggregateArgs<S extends Spec, K extends keyof S> = {
  where?: Where<S, K>;
  deleted?: DeletedMode;
  orderBy?:
    | Partial<Record<keyof QueryableRow<S, K>, 'asc' | 'desc'>>
    | Partial<Record<keyof QueryableRow<S, K>, 'asc' | 'desc'>>[];
  skip?: number;
  take?: number;
  _count?: true | (Fields<QueryableRow<S, K>> & { _all?: boolean });
  _sum?: Fields<QueryableRow<S, K>, Numeric<QueryableRow<S, K>>>;
  _avg?: Fields<QueryableRow<S, K>, Numeric<QueryableRow<S, K>>>;
  _min?: Fields<QueryableRow<S, K>, Comparable<QueryableRow<S, K>>>;
  _max?: Fields<QueryableRow<S, K>, Comparable<QueryableRow<S, K>>>;
};
type Selected<P, V> = { [F in keyof P as P[F] extends false | undefined ? never : F]: V };
export type AggregateResult<R, A> = {
  [
    Op in keyof A as Op extends '_count' | '_sum' | '_avg' | '_min' | '_max' ? Op : never
  ]: Op extends '_count'
    ? A[Op] extends true
      ? number
      : Selected<A[Op], number>
    : Op extends '_avg'
      ? Selected<A[Op], number | null>
      : {
          [F in keyof A[Op] as A[Op][F] extends false | undefined ? never : F]: F extends keyof R
            ? R[F] | null
            : never;
        };
};
type Having<R> = {
  [F in keyof R]?:
    | R[F]
    | (ScalarFilter<R[F]> & {
        _count?: ScalarFilter<number>;
        _sum?: ScalarFilter<number>;
        _avg?: ScalarFilter<number>;
        _min?: ScalarFilter<R[F]>;
        _max?: ScalarFilter<R[F]>;
      });
} & { AND?: Having<R>[]; OR?: Having<R>[]; NOT?: Having<R> };
export type GroupByArgs<S extends Spec, K extends keyof S> = Omit<
  AggregateArgs<S, K>,
  'orderBy'
> & {
  by: readonly (keyof QueryableRow<S, K>)[];
  having?: Having<QueryableRow<S, K>>;
  orderBy?: GroupOrder<QueryableRow<S, K>> | GroupOrder<QueryableRow<S, K>>[];
};
type GroupOrder<R> = Partial<Record<keyof R, 'asc' | 'desc'>> & {
  _count?: Partial<Record<keyof R | '_all', 'asc' | 'desc'>>;
  _sum?: Partial<Record<Numeric<R>, 'asc' | 'desc'>>;
  _avg?: Partial<Record<Numeric<R>, 'asc' | 'desc'>>;
  _min?: Partial<Record<Comparable<R>, 'asc' | 'desc'>>;
  _max?: Partial<Record<Comparable<R>, 'asc' | 'desc'>>;
};
export type GroupByResult<R, A extends { by: readonly PropertyKey[] }> = Pick<
  R,
  A['by'][number] & keyof R
> &
  AggregateResult<R, A>;
