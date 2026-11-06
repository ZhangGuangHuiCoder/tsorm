export class OrmError extends Error {
  constructor(
    public code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OrmError';
  }
}
export const fail = (message: string): never => {
  throw new OrmError('VALIDATION', message);
};
