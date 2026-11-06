import type { DeletedMode } from '../query/visibility.js';
import type { DateTimeInput } from '../shared/datetime.js';
import type { RawClient } from './raw.js';
import type {
  AggregateArgs,
  AggregateResult,
  GroupByArgs,
  GroupByResult,
} from './analytics-types.js';
import type { NumericUpdate } from '../query/updates.js';
export type FieldUpdate<T> =
  | T
  | (NonNullable<T> extends number
      ? NumericUpdate<T>
      : NonNullable<T> extends bigint
        ? NumericUpdate<T, bigint | number>
        : { set: T });
/** Update input of a decimal field: a value, `{ set }` or arithmetic with decimal operands. */
export type DecimalUpdate<T extends string | number | null> = T | NumericUpdate<T, string | number>;
import type { Capabilities, TransactionOptions } from './adapter.js';
export type Spec = Record<
  string,
  {
    row: Record<string, any>;
    dateFields?: string;
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
type Target<
  S extends Spec,
  K extends keyof S,
  R extends keyof S[K]['relations'],
> = S[K]['relations'][R]['target'] & keyof S;
export type ScalarFilter<T> = {
  equals?: T;
  in?: T[];
  notIn?: T[];
  not?: T | ScalarFilter<T>;
} & (NonNullable<T> extends string
  ? {
      contains?: string;
      startsWith?: string;
      endsWith?: string;
      mode?: 'default' | 'insensitive';
    }
  : {}) &
  (NonNullable<T> extends string | number | bigint | Date
    ? {
        gt?: T;
        gte?: T;
        lt?: T;
        lte?: T;
      }
    : {});
type InputField<
  S extends Spec,
  K extends keyof S,
  F extends keyof S[K]['row'],
> = F extends S[K]['dateFields']
  ? DateTimeInput | (null extends S[K]['row'][F] ? null : never)
  : S[K]['row'][F];
type PhysicalRow<S extends Spec, K extends keyof S> = Omit<
  S[K]['row'],
  S[K] extends { virtualFields: infer V extends string } ? V : never
>;
export type QueryableRow<S extends Spec, K extends keyof S> = Omit<
  PhysicalRow<S, K>,
  S[K] extends { jsonFields: infer J extends string } ? J : never
>;
/** Filter on a value inside a JSON field, addressed by object keys and array indexes. */
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
export type Where<S extends Spec, K extends keyof S> = {
  [F in keyof QueryableRow<S, K>]?: InputField<S, K, F> | ScalarFilter<InputField<S, K, F>>;
} & {
  [F in JsonField<S, K>]?: JsonFilter;
} & {
  [R in keyof S[K]['relations']]?: S[K]['relations'][R]['many'] extends true
    ? {
        some?: Where<S, Target<S, K, R>>;
        none?: Where<S, Target<S, K, R>>;
        every?: Where<S, Target<S, K, R>>;
      }
    : {
        is?: Where<S, Target<S, K, R>> | null;
        isNot?: Where<S, Target<S, K, R>> | null;
      };
} & {
  AND?: Where<S, K>[];
  OR?: Where<S, K>[];
  NOT?: Where<S, K>;
};
export type Select<S extends Spec, K extends keyof S> = {
  [F in keyof S[K]['row']]?: boolean;
} & Include<S, K>;
type ManyRelations<S extends Spec, K extends keyof S> = {
  [R in keyof S[K]['relations']]: S[K]['relations'][R]['many'] extends true ? R : never;
}[keyof S[K]['relations']];
type CountSelect<S extends Spec, K extends keyof S> = {
  [R in ManyRelations<S, K>]?: boolean | { where?: Where<S, Target<S, K, R>> };
};
type Include<S extends Spec, K extends keyof S> = {
  _count?: boolean | { select: CountSelect<S, K> };
} & {
  [R in keyof S[K]['relations']]?: boolean | Query<S, Target<S, K, R>>;
};
/** NULL sorts as the smallest value unless `nulls` places it explicitly. */
export type SortOrder = 'asc' | 'desc' | { sort: 'asc' | 'desc'; nulls?: 'first' | 'last' };
/** Sort by fields, by fields of a related record, or by the number of related records. */
export type OrderBy<S extends Spec, K extends keyof S> = Partial<
  Record<keyof QueryableRow<S, K>, SortOrder>
> & {
  [R in keyof S[K]['relations']]?: S[K]['relations'][R]['many'] extends true
    ? { _count: 'asc' | 'desc' }
    : OrderBy<S, Target<S, K, R>>;
};
export type Query<S extends Spec, K extends keyof S> = {
  where?: Where<S, K>;
  deleted?: DeletedMode;
  orderBy?: OrderBy<S, K> | OrderBy<S, K>[];
  skip?: number;
  take?: number;
  cursor?: S[K]['unique'];
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
type RelValue<
  S extends Spec,
  K extends keyof S,
  R extends keyof S[K]['relations'],
  Q,
> = S[K]['relations'][R]['many'] extends true
  ? Payload<S, Target<S, K, R>, Q>[]
  : Payload<S, Target<S, K, R>, Q> | (S[K]['relations'][R]['nullable'] extends true ? null : never);
type CountResult<S extends Spec, K extends keyof S, Q> = Q extends true
  ? { [R in ManyRelations<S, K>]: number }
  : Q extends { select: infer P }
    ? { [R in keyof P as P[R] extends false | undefined ? never : R]: number }
    : never;
type Value<S extends Spec, K extends keyof S, F, Q> = F extends '_count'
  ? CountResult<S, K, Q>
  : F extends keyof S[K]['row']
    ? S[K]['row'][F]
    : F extends keyof S[K]['relations']
      ? RelValue<S, K, F, Q>
      : never;
type Projection<S extends Spec, K extends keyof S, P> = {
  [
    F in keyof P as P[F] extends false | undefined ? never : boolean extends P[F] ? never : F
  ]: Value<S, K, F, P[F]>;
} & {
  [F in keyof P as boolean extends P[F] ? F : never]?: Value<S, K, F, P[F]>;
};
export type Payload<S extends Spec, K extends keyof S, Q> = Q extends {
  select: infer P;
}
  ? Projection<S, K, P>
  : Omitted<S[K]['row'], MergeOmit<S[K]['omitted'], Q extends { omit: infer O } ? O : undefined>> &
      (Q extends {
        include: infer P;
      }
        ? Projection<S, K, P>
        : {});
type QueryBase<S extends Spec, K extends keyof S> = Pick<
  Query<S, K>,
  'where' | 'orderBy' | 'skip' | 'take' | 'cursor' | 'distinct' | 'deleted'
>;
export type OmitFields<S extends Spec, K extends keyof S> = Partial<
  Record<keyof S[K]['row'], boolean>
>;
/** createClient({ omit }) option: per model (lowerCamelCase), fields to leave out. */
export type GlobalOmit<S extends Spec> = {
  [K in keyof S as Uncapitalize<K & string>]?: Partial<Record<keyof S[K]['row'], boolean>>;
};
export type WithOmit<S extends Spec, O> = {
  [K in keyof S]: S[K] & {
    omitted: Uncapitalize<K & string> extends keyof O
      ? Extract<O[Uncapitalize<K & string>], Record<string, any>>
      : undefined;
  };
};
/** The query's omit overrides the client-wide one field by field. */
type MergeOmit<D, O> = [D] extends [Record<string, any>]
  ? [O] extends [undefined]
    ? D
    : Omit<D, keyof O> & O
  : O;
type Omitted<R, O> = Omit<R, Extract<keyof O, keyof R>> & {
  [
    F in Extract<keyof O, keyof R> as O[F] extends true
      ? never
      : O[F] extends false | undefined
        ? F
        : never
  ]: R[F];
} & {
  [F in Extract<keyof O, keyof R> as boolean extends O[F] ? F : never]?: R[F];
};
type ProjectionInput<S extends Spec, K extends keyof S, P, I, O = undefined> =
  | { select: P & Select<S, K>; include?: never; omit?: never }
  | { select?: never; include: I & Include<S, K>; omit?: O & OmitFields<S, K> }
  | { select?: never; include?: never; omit?: O & OmitFields<S, K> };
type Result<S extends Spec, K extends keyof S, P, I, O = undefined> = [P] extends [undefined]
  ? [I] extends [undefined]
    ? Omitted<S[K]['row'], MergeOmit<S[K]['omitted'], O>>
    : Omitted<S[K]['row'], MergeOmit<S[K]['omitted'], O>> & Projection<S, K, I>
  : Projection<S, K, P>;
interface ModelClient<S extends Spec, K extends keyof S> {
  findMany<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args?: QueryBase<S, K> & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>[]>;
  findManyAndCount<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args?: QueryBase<S, K> & ProjectionInput<S, K, P, I, O>,
  ): Promise<{ data: Result<S, K, P, I, O>[]; total: number }>;
  findFirst<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args?: QueryBase<S, K> & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O> | null>;
  findUnique<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: Omit<QueryBase<S, K>, 'where'> & { where: S[K]['unique'] } & ProjectionInput<
        S,
        K,
        P,
        I,
        O
      >,
  ): Promise<Result<S, K, P, I, O> | null>;
  create<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { data: S[K]['create'] } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  update<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { where: S[K]['unique']; data: S[K]['update'] } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  delete<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { where: S[K]['unique'] } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  upsert<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: {
      where: S[K]['unique'];
      create: S[K]['create'];
      update: S[K]['update'];
    } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  findUniqueOrThrow<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: Omit<QueryBase<S, K>, 'where'> & { where: S[K]['unique'] } & ProjectionInput<
        S,
        K,
        P,
        I,
        O
      >,
  ): Promise<Result<S, K, P, I, O>>;
  findFirstOrThrow<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args?: QueryBase<S, K> & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  aggregate<const A extends AggregateArgs<S, K>>(
    args: A & AggregateArgs<S, K>,
  ): Promise<AggregateResult<S[K]['row'], A>>;
  groupBy<const A extends GroupByArgs<S, K>>(
    args: A & GroupByArgs<S, K>,
  ): Promise<GroupByResult<S[K]['row'], A>[]>;
  restore<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { where: S[K]['unique'] } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  restoreMany(args?: { where?: Where<S, K> }): Promise<{ count: number }>;
  forceDelete<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { where: S[K]['unique'] } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>>;
  forceDeleteMany(args?: { where?: Where<S, K> }): Promise<{ count: number }>;
  createMany(args: {
    data: S[K]['scalarCreate'][];
    skipDuplicates?: boolean;
  }): Promise<{ count: number }>;
  createManyAndReturn<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { data: S[K]['scalarCreate'][]; skipDuplicates?: boolean } & ProjectionInput<
      S,
      K,
      P,
      I,
      O
    >,
  ): Promise<Result<S, K, P, I, O>[]>;
  updateManyAndReturn<
    const P extends Select<S, K> | undefined = undefined,
    const I extends Include<S, K> | undefined = undefined,
    const O extends OmitFields<S, K> | undefined = undefined,
  >(
    args: { where?: Where<S, K>; data: S[K]['scalarUpdate'] } & ProjectionInput<S, K, P, I, O>,
  ): Promise<Result<S, K, P, I, O>[]>;
  updateMany(args: { where?: Where<S, K>; data: S[K]['scalarUpdate'] }): Promise<{ count: number }>;
  deleteMany(args?: { where?: Where<S, K> }): Promise<{ count: number }>;
  count(args?: {
    where?: Where<S, K>;
    distinct?: keyof QueryableRow<S, K> | readonly (keyof QueryableRow<S, K>)[];
    deleted?: DeletedMode;
  }): Promise<number>;
}
export type TxClient<S extends Spec> = RawClient & {
  [K in keyof S as Uncapitalize<K & string>]: ModelClient<S, K>;
};
export type Client<S extends Spec> = TxClient<S> & {
  $transaction<T>(fn: (tx: TxClient<S>) => Promise<T>, options?: TransactionOptions): Promise<T>;
  $capabilities: Readonly<Capabilities>;
  $close(): Promise<void>;
};
