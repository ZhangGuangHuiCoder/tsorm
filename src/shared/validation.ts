import { fail } from "./errors.js";
export const object = (x: any) => {
  return x !== null && typeof x === "object" && !Array.isArray(x) && !(x instanceof Date) && !(x instanceof Uint8Array);
};
export const checkObject = (x: any, label: string) => {
  if (!object(x)) {
    fail(`${label} must be an object`);
  }
};
/** Bulk writes must carry a condition; `{}` would match every row, so full-table work goes through `$clear`. */
export const requireWhere = (args: any, operation: string) => {
  if (args.where === undefined) {
    fail(`${operation} requires where`);
  }
  if (!object(args.where) || Object.keys(args.where).length === 0) {
    fail(`${operation} requires a non-empty where`);
  }
};
