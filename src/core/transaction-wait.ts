import type { RuntimeAdapter, Session } from './adapter.js';
import { OrmError } from '../shared/errors.js';
export async function acquireTransaction(
  adapter: RuntimeAdapter,
  maxWait?: number,
): Promise<Session> {
  if (maxWait === undefined) return adapter.acquire();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = adapter.acquire().then(async (session) => {
    if (expired) {
      await session.release();
      throw new OrmError('TRANSACTION_MAX_WAIT', 'Connection arrived after maxWait');
    }
    return session;
  });
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            new OrmError('TRANSACTION_MAX_WAIT', 'Timed out waiting for transaction connection'),
          );
        }, maxWait);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
