import { fail } from './errors.js';
export const object = (x: any) =>
  x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) &&
  !(x instanceof Uint8Array);
export const checkObject = (x: any, label: string) => {
  if (!object(x)) fail(`${label} must be an object`);
};
