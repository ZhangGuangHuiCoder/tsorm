export { MigrationError } from './errors.js';
export { migrate, deploy, status, resolve, diff, push } from './commands.js';
export type {
  Prompter,
  CommandOptions,
  MigrateResult,
  StatusResult,
  DiffSource,
  DiffResult,
} from './commands.js';
export type { SchemaDiff } from './diff.js';
export type { MigrationProvider } from './provider.js';
