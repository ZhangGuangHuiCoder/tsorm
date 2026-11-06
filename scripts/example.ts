import { cli, node } from './lib.js';

/** 必须明确写出数据库，不提供隐式默认值。 */
export async function example([database]) {
  if (!['sqlite', 'mysql', 'pgsql'].includes(database))
    throw new Error('Use bun run example <sqlite|mysql|pgsql>');
  await node('examples/demo.ts', database);
}
await cli(import.meta, example);
