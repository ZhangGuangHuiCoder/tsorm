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
/** Abort a bulk write that would touch more rows than `maxAffected`, the last line of defence against a wrong filter. */
export const guardMassWrite = (operation: string, table: string, matched: number, maxAffected?: number): void => {
  if (maxAffected !== undefined && matched > maxAffected) {
    throw new OrmError("MASS_WRITE_BLOCKED", `${operation} on ${table} matched ${matched} rows, above maxAffected ${maxAffected}`);
  }
};
