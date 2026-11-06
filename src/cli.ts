#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseSchema, generateClient } from './schema/index.js';
import {
  deploy,
  diff,
  migrate,
  push,
  resolve as resolveMigration,
  status,
  type CommandOptions,
  type DiffSource,
  type Prompter,
} from './migrations/index.js';

const usage = `Usage: tsorm <command> [options]

  migrate     Create and apply a migration from schema changes (development)
              --name <name>   --create-only   --reset   --force
  deploy      Apply pending migrations (production)
              --check: only report whether the database is up to date
  resolve     Mark a failed migration: --applied <name> | --rolled-back <name>
  diff        Print the SQL between two sources, default migrations -> schema
              --from migrations|database|empty   --to schema|database   --check
  push        Sync the database with the schema, without migrations
              --reset   --force

  validate    Validate the schema file
  generate    Generate the TypeScript client (--out <file>)

Options:
  --schema <file>   Schema file, default schema.orm; migrations live next to it
  --force           Skip confirmations and accept data loss

Environment:
  DATABASE_URL          Default file:./dev.db; also postgresql://... or mysql://...
  SHADOW_DATABASE_URL   Optional shadow database for MySQL and PostgreSQL`;

const valued = ['--schema', '--name', '--applied', '--rolled-back', '--from', '--to', '--out', '--dialect'];
const flags: Record<string, string[]> = {
  migrate: ['--schema', '--name', '--create-only', '--reset', '--force'],
  deploy: ['--schema', '--check'],
  resolve: ['--schema', '--applied', '--rolled-back'],
  diff: ['--schema', '--from', '--to', '--check'],
  push: ['--schema', '--reset', '--force'],
  validate: ['--schema'],
  generate: ['--schema', '--out'],
};

/** Parses `--flag value`, `--flag=value` and boolean flags, rejecting unknown ones. */
function parseArgs(command: string, args: string[]) {
  const values = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s, 2);
    const name = flag === '-n' ? '--name' : flag;
    if (!flags[command].includes(name)) throw Error(`Unknown option ${args[i]}\n\n${usage}`);
    if (!valued.includes(name)) {
      values.set(name, true);
      continue;
    }
    const value = inline ?? args[++i];
    if (value === undefined || value.startsWith('--')) throw Error(`Missing value for ${name}`);
    values.set(name, value);
  }
  return {
    get: (name: string) => {
      const v = values.get(name);
      return typeof v === 'string' ? v : undefined;
    },
    has: (name: string) => values.has(name),
  };
}

const interactive = () => !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
const prompter = (): Prompter | undefined =>
  interactive()
    ? {
        async confirm(message) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return /^y(es)?$/i.test((await rl.question(`${message} › (y/N) `)).trim());
          } finally {
            rl.close();
          }
        },
      }
    : undefined;

const agents: [string, string][] = [
  ['CLAUDECODE', 'Claude Code'],
  ['GEMINI_CLI', 'Gemini CLI'],
  ['QWEN_CODE', 'Qwen Code'],
  ['CURSOR_AGENT', 'Cursor'],
  ['AIDER_MODEL', 'Aider'],
  ['REPL_ID', 'Replit'],
];
/** Blocks destructive commands started by AI coding agents until the user consents. */
function guardAgent(action: string) {
  const agent = agents.find(([variable]) => process.env[variable])?.[1];
  if (!agent || process.env.TSORM_USER_CONSENT_FOR_DANGEROUS_AI_ACTION) return;
  throw Error(
    `tsorm detected that it was invoked by ${agent}.\n\n` +
      `You are attempting a destructive action that deletes data: ${action}\n\n` +
      'As an AI agent, you must not perform this action without explicit consent from the user. ' +
      'Ask the user for consent, then set the TSORM_USER_CONSENT_FOR_DANGEROUS_AI_ACTION environment variable to the exact text of the consent message and run the command again.',
  );
}

const source = (value: string | undefined, allowed: DiffSource[], name: string) => {
  if (value !== undefined && !allowed.includes(value as DiffSource))
    throw Error(`${name} must be ${allowed.join(', ')}`);
  return value as DiffSource | undefined;
};

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const log = (message: string) => console.log(message);
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(usage);
    return command ? 0 : 1;
  }
  if (!flags[command]) throw Error(`Unknown command ${command}\n\n${usage}`);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return 0;
  }
  const options = parseArgs(command, args);
  if (command === 'validate' || command === 'generate') {
    const path = resolve(options.get('--schema') ?? 'schema.orm');
    const schema = parseSchema(readFileSync(path, 'utf8'));
    if (command === 'validate') {
      log(`The schema at ${relative(process.cwd(), path)} is valid: ${Object.keys(schema.tables).length} models`);
      return 0;
    }
    if (command === 'generate') {
      const output = resolve(options.get('--out') ?? 'generated/client.ts');
      const runtime = fileURLToPath(new URL('./index.js', import.meta.url));
      const spec = relative(dirname(output), runtime).replaceAll('\\', '/');
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, generateClient(schema, spec.startsWith('.') ? spec : './' + spec));
      log(output);
      return 0;
    }
  }
  const base: CommandOptions = {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
    schema: options.get('--schema'),
    force: options.has('--force'),
    prompt: prompter(),
    log,
  };
  switch (command) {
    case 'migrate':
      if (options.has('--reset')) guardAgent('tsorm migrate --reset');
      await migrate({
        ...base,
        name: options.get('--name'),
        createOnly: options.has('--create-only'),
        reset: options.has('--reset'),
      });
      return 0;
    case 'deploy': {
      if (!options.has('--check')) {
        await deploy(base);
        return 0;
      }
      const result = await status(base);
      log(result.message);
      return result.exitCode;
    }
    case 'resolve':
      await resolveMigration({
        ...base,
        applied: options.get('--applied'),
        rolledBack: options.get('--rolled-back'),
      });
      return 0;
    case 'diff': {
      const result = await diff({
        ...base,
        from: source(options.get('--from'), ['migrations', 'database', 'empty'], '--from'),
        to: source(options.get('--to'), ['schema', 'database'], '--to'),
      });
      if (!options.has('--check')) {
        process.stdout.write(result.sql);
        return 0;
      }
      process.stdout.write(result.summary);
      return result.diff.empty ? 0 : 2;
    }
    default:
      if (options.has('--reset') || options.has('--force'))
        guardAgent(`tsorm push ${options.has('--reset') ? '--reset' : '--force'}`);
      await push({ ...base, reset: options.has('--reset') });
      return 0;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  console.error(typeof code === 'string' && /^[A-Z_]+$/.test(code) ? `Error: ${code}\n\n${message}` : message);
  process.exitCode = 1;
}
