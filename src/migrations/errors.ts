export class MigrationError extends Error {
  constructor(
    public code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
  }
}
