import { rm } from 'node:fs/promises';
import { cli } from './lib.js';

export async function clean() {
  for (const path of [
    'dist',
    'extensions/dist',
    'docs/.vitepress/cache',
    'docs/.vitepress/dist',
    'artifacts',
  ])
    await rm(path, { recursive: true, force: true });
}
await cli(import.meta, clean);
