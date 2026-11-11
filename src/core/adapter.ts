import type { Schema, Column, Table } from "../schema/index.js";
export type IsolationLevel = "read committed" | "repeatable read" | "serializable";
export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: IsolationLevel;
}
export interface Capabilities {
  returning: boolean;
  windowFunctions: boolean;
  transactionalDDL: boolean;
  versionedMigrations: boolean;
  isolationLevels: readonly IsolationLevel[];
}
export interface CompiledSQL {
  text: string;
  values: any[];
}
export interface QueryResult {
  rows: any[];
  affectedRows: number;
  insertId?: unknown;
}
export interface Session {
  execute(sql: CompiledSQL): Promise<QueryResult>;
  begin(options?: TransactionOptions & { readOnly?: boolean }): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(broken?: boolean): void | Promise<void>;
  /** Cancels the statement running on the server, over a separate connection. Best effort. */
  cancel?(): Promise<void>;
}
interface JsonContext {
  /** Pushes a bound parameter and returns its placeholder token. */
  bind(params: any[], value: any): string;
  /** Escapes a LIKE pattern for `op`, adding leading/trailing wildcards. */
  pattern(op: string, value: string): string;
  truth: string;
  falsity: string;
}
/** Builds the dialect-specific SQL for a JSON path filter. */
interface JsonDialect {
  predicate(col: string, path: (string | number)[], value: Record<string, any>, params: any[], ctx: JsonContext): string;
}
export interface Dialect {
  /** Display/debug label only; never branch on it. */
  name: string;
  quote(name: string): string;
  parameter(index: number): string;
  encode(column: Column, value: any): any;
  decode(table: Table, row: any): any;
  groupKey(column: Column, value: any): string;
  unlimited: number | null;
  trueLiteral: string;
  falseLiteral: string;
  emptyInsertValues: string;
  onConflictDoNothing(): string;
  upsertConflictSuffix(conflictColumns: string): string;
  deleteKeyword(alias: string): string;
  pageValue(value: number | null): number | bigint | null;
  bigintOperand(value: any): any;
  wrapDecimalOperand(operand: string): string;
  /** Decimal comparison parameters for engines whose aggregate expressions have no affinity. */
  decimalComparisonOperand?(operand: string): string;
  integerDivide(expr: string): string;
  containsPredicate(col: string, placeholder: string, insensitive: boolean): string;
  /** `NULLS FIRST`/`NULLS LAST` when the dialect supports it natively, otherwise undefined. */
  nullsOrder(first: boolean): string | undefined;
  booleanMinMax(op: "MIN" | "MAX", expr: string): string;
  defaultTransactionIsolation(readOnly: boolean): IsolationLevel;
  json: JsonDialect;
}
export interface RuntimeAdapter {
  dialect: Dialect;
  capabilities: Capabilities;
  acquire(): Promise<Session>;
  close(): Promise<void>;
  translate(error: any): Error;
}
export interface Adapter {
  readonly name: Dialect["name"];
  connect(schema: Schema): RuntimeAdapter | Promise<RuntimeAdapter>;
}
