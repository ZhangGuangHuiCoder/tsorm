import { fail } from "../shared/errors.js";
export type DeletedMode = "exclude" | "include" | "only";
export const visibility = Symbol("visibility");
export function visibleWhere(where: any, mode?: DeletedMode): any {
  if (where !== undefined && (where === null || typeof where !== "object" || Array.isArray(where))) {
    fail("where must be an object");
  }
  const selected = mode ?? where?.[visibility] ?? "exclude";
  if (!["exclude", "include", "only"].includes(selected)) {
    fail("Invalid deleted mode");
  }
  return { ...where, [visibility]: selected };
}
