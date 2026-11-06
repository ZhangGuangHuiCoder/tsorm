import { virtualField } from '../dist/index.js';
import type { AccountRow } from './client.ts';
import { mysql, postgres, sqlite } from '../dist/adapters/index.js';
import { createClient } from './client.ts';
import type { Logger } from '../dist/index.js';
// Replace this callback with your own logger or event collector.
const logger: Logger = (event) => {
  if (event.type === 'query') console.log(event.status, event.sql, event.durationMs);
};
/** Picks the database from `bun run example sqlite|mysql|pgsql`; connections come from env. */
function adapter(database: string) {
  const initialize = process.env.ORM_INITIALIZE !== '0';
  if (database === 'mysql')
    return mysql({
      initialize,
      connection: {
        cachingRsaPublicKey: process.env.MYSQL_RSA_PUBLIC_KEY,
        allowPublicKeyRetrieval: process.env.MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL === '1',
        host: process.env.MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.MYSQL_PORT ?? 3307),
        user: process.env.MYSQL_USER ?? 'root',
        password: process.env.MYSQL_PASSWORD ?? 'local_test_only',
        database: process.env.MYSQL_DATABASE ?? 'tsorm_test',
        connectionLimit: 5,
      },
    });
  if (database === 'pgsql')
    return postgres({
      initialize,
      dbSchema: process.env.PGSCHEMA ?? 'public',
      connection: process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.PGHOST ?? '127.0.0.1',
            port: Number(process.env.PGPORT ?? 5433),
            user: process.env.PGUSER ?? 'postgres',
            password: process.env.PGPASSWORD ?? 'local_test_only',
            database: process.env.PGDATABASE ?? 'tsorm_test',
            max: 5,
          },
    });
  if (database === 'sqlite')
    return sqlite({ filename: process.env.SQLITE_FILE ?? ':memory:', initialize });
  throw new Error('Use bun run example <sqlite|mysql|pgsql>');
}
const defineAccountVirtual = virtualField<AccountRow>();
const db = await createClient({
  virtuals: {
    account: {
      displayName: defineAccountVirtual({
        needs: { email: true, name: true },
        compute: (row) => row.name ?? row.email,
      }),
    },
  },
  timezone: process.env.ORM_TIMEZONE ?? '+08:00',
  adapter: adapter(process.argv[2] ?? ''),
  logger,
});
try {
  const email = 'demo-' + Date.now() + '@example.com';
  const user = await db.user.create({
    data: {
      email,
      name: 'Alice',
      profile: { create: { bio: 'ORM example' } },
      posts: {
        create: [
          { title: 'Published', published: true, tags: { create: { name: 'tag-' + Date.now() } } },
          { title: 'Draft' },
        ],
      },
    },
    include: { profile: true, posts: { include: { tags: true } } },
  });
  console.log('nested create', user);
  console.log(
    'aggregates',
    await db.post.aggregate({
      where: { authorId: user.id },
      _count: true,
      _sum: { views: true },
      _avg: { views: true },
    }),
  );
  console.log(
    'groups',
    await db.post.groupBy({
      by: ['published'],
      where: { authorId: user.id },
      _count: true,
      _sum: { views: true },
      orderBy: { published: 'asc' },
    }),
  );
  console.log(
    'relation counts',
    await db.user.findUnique({
      where: { id: user.id },
      select: { email: true, _count: { select: { posts: true } } },
    }),
  );
  console.log(
    'omit and distinct',
    await db.post.findMany({
      where: { authorId: user.id },
      distinct: 'authorId',
      omit: { authorId: true },
    }),
  );
  console.log(
    'cursor page',
    await db.post.findMany({
      where: { authorId: user.id },
      cursor: { id: user.posts[0].id },
      skip: 1,
      take: 1,
      orderBy: { id: 'asc' },
      select: { title: true },
    }),
  );
  console.log(
    'raw binding',
    await db.$queryRaw<{ demo_value: unknown }[]>`SELECT ${user.id} AS demo_value`,
  );

  console.log('unique', await db.user.findUnique({ where: { email } }));
  console.log(
    'relation filter and pagination',
    await db.user.findMany({
      where: { id: user.id, posts: { some: { published: true } } },
      select: {
        email: true,
        name: true,
        posts: {
          where: { published: true },
          orderBy: { id: 'desc' },
          take: 2,
          select: { title: true, tags: { select: { name: true } } },
        },
      },
    }),
  );
  const draft = await db.post.create({
    data: { title: 'Connected', author: { connect: { id: user.id } } },
  });
  await db.post.update({
    where: { id: draft.id },
    data: { published: { set: true }, views: { increment: 1 } },
  });
  console.log(
    'upsert existing user',
    await db.user.upsert({
      where: { email },
      create: { email },
      update: { name: { set: 'Upserted' } },
      select: { email: true, name: true },
    }),
  );
  await db.user.update({
    where: { id: user.id },
    data: {
      profile: { update: { bio: 'Updated profile' } },
      posts: { update: { where: { id: draft.id }, data: { views: { multiply: 2 } } } },
    },
  });
  console.log(
    'required post',
    await db.post.findUniqueOrThrow({
      where: { id: draft.id },
      select: { title: true, views: true },
    }),
  );

  console.log(
    'skip duplicate email',
    await db.user.createMany({ data: [{ email }], skipDuplicates: true }),
  );
  console.log(
    'bulk returning',
    await db.post.createManyAndReturn({
      data: [
        { title: 'Batch A', authorId: user.id },
        { title: 'Batch B', authorId: user.id },
      ],
      select: { id: true, title: true },
    }),
  );
  console.log(
    'updateManyAndReturn',
    await db.post.updateManyAndReturn({
      where: { authorId: user.id, published: false },
      data: { published: true },
    }),
  );
  await db.$transaction(
    async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: 'Updated' } });
      console.log('count in transaction', await tx.post.count({ where: { authorId: user.id } }));
    },
    { isolationLevel: 'serializable' },
  );
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: 'Rolled back' } });
      throw new Error('rollback example');
    });
  } catch (error) {
    console.log('expected rollback', (error as Error).message);
  }
  console.log(
    'after rollback',
    await db.user.findUnique({ where: { id: user.id }, select: { email: true, name: true } }),
  );
  const tagIds = user.posts.flatMap((post) => post.tags.map((tag) => tag.id));
  await db.post.delete({ where: { id: draft.id } });
  console.log('deleteMany', await db.post.deleteMany({ where: { authorId: user.id } }));
  await db.profile.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  await db.tag.deleteMany({ where: { id: { in: tagIds } } });

  const account = await db.$transaction(
    async () => {
      const row = await db.account.create({
        data: {
          email: 'account-' + Date.now() + '@example.com',
          preferences: { theme: 'dark', notifications: true, languages: ['zh', 'en'] },
          entries: { create: { title: 'First entry' } },
        },
      });
      await db.accountEntry.create({
        data: { title: 'Automatic transaction context', accountId: row.id },
      });
      return row;
    },
    { isolationLevel: 'serializable' },
  );
  try {
    console.log(
      'snapshot page',
      await db.account.findManyAndCount({
        where: { id: account.id },
        take: 10,
        select: { displayName: true, preferences: true, _count: { select: { entries: true } } },
      }),
    );
    await db.accountEntry.deleteMany({ where: { accountId: account.id } });
    console.log(
      'hidden entries',
      await db.account.findUnique({ where: { id: account.id }, include: { entries: true } }),
    );
    await db.accountEntry.restoreMany({ where: { accountId: account.id } });
    await db.account.delete({ where: { id: account.id } });
    console.log(
      'deleted account',
      await db.account.findMany({ where: { id: account.id }, deleted: 'only' }),
    );
    await db.account.restore({ where: { id: account.id } });
  } finally {
    await db.accountEntry.forceDeleteMany({ where: { accountId: account.id } });
    await db.account.forceDelete({ where: { id: account.id } });
  }

  console.log('cleanup complete');
} finally {
  await db.$close();
}
