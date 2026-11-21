// ─── Errors ────────────────────────────────────────────────────────────────
export class OrmError extends Error {
  constructor(
    public code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OrmError";
  }
}
export const fail = (message: string): never => {
  throw new OrmError("VALIDATION", message);
};

// ─── Object validation ─────────────────────────────────────────────────────
export const object = (x: any) => {
  return x !== null && typeof x === "object" && !Array.isArray(x) && !(x instanceof Date) && !(x instanceof Uint8Array);
};
export const checkObject = (x: any, label: string) => {
  if (!object(x)) {
    fail(`${label} must be an object`);
  }
};
/**
 * 仅接受只含给定键的对象。
 * Accepts only an object holding nothing but the given keys.
 */
export const checkOptions = (x: any, label: string, ...allowed: string[]) => {
  checkObject(x, label);
  if (
    Object.keys(x).some((k) => {
      return !allowed.includes(k);
    })
  ) {
    fail(`Unknown ${label} option`);
  }
};
/**
 * 批量写入必须携带条件；`{}` 会匹配所有行，因此全表操作通过 `$clear` 执行。
 * Bulk writes must carry a condition; `{}` would match every row, so full-table work goes through `$clear`.
 */
export const requireWhere = (args: any, operation: string) => {
  if (args.where === undefined) {
    fail(`${operation} requires where`);
  }
  if (!object(args.where) || Object.keys(args.where).length === 0) {
    fail(`${operation} requires a non-empty where`);
  }
};
/**
 * 当批量写入将影响超过 `maxAffected` 行时中止，这是防止错误过滤条件的最后一道防线。
 * Abort a bulk write that would touch more rows than `maxAffected`, the last line of defence against a wrong filter.
 */
export const guardMassWrite = (operation: string, table: string, matched: number, maxAffected?: number): void => {
  if (maxAffected !== undefined && matched > maxAffected) {
    throw new OrmError("MASS_WRITE_BLOCKED", `${operation} on ${table} matched ${matched} rows, above maxAffected ${maxAffected}`);
  }
};
