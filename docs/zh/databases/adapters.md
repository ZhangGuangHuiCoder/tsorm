---
description: SQLite、MySQL / MariaDB 和 PostgreSQL 适配器的配置、类型细节、初始化、事务模型和错误映射。
---

# 数据库适配器

三个适配器共用一套模型语法和一套客户端 API，切换数据库无需重新生成。物理类型对应关系见[类型映射](./overview.md#类型映射)。每个适配器都会固定驱动选项和会话设置，以保证结果被正确解码。

## SQLite

基于 Node.js 内置的 `node:sqlite`（`DatabaseSync`），不需要独立服务或额外驱动。

### 连接

```ts
import { createClient } from './generated/client.ts';
import { sqlite } from '@ofis/tsorm/adapters/sqlite';

const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite' }),
});
```

| 选项         | 类型      | 默认值       | 说明                     |
| ------------ | --------- | ------------ | ------------------------ |
| `filename`   | `string`  | `:memory:`   | 数据库文件，省略时使用内存数据库 |
| `initialize` | `boolean` | `false`      | 创建全部表，见下文       |

连接时启用 `PRAGMA foreign_keys=ON`，并设置 `busy_timeout` 为 5000 毫秒。

### 类型细节

- SQLite 只有数值和文本亲和性：`string`、`date` 和 JSON 共用 `TEXT`，`boolean` 和整数共用 `INTEGER`。长度、枚举、布尔取值和 JSON 合法性由 `CHECK` 约束保证。
- 整数按 `bigint` 读取，再检查安全整数范围。
- 日期按客户端时区写成文本，读取时原样返回。
- 无长度的字符串可以建立索引。非唯一外键列会自动添加索引。

### 初始化

`initialize: true` 在一个事务内执行全部 DDL，失败时整体回滚并关闭连接。

::: warning
`initialize` 只用于新数据库，不会删除已有表；结构升级请使用[版本化迁移](./migrations.md)。重新连接已有数据库时请省略，同一个数据库只由一个进程初始化。
:::

导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=file:./app.sqlite tsorm diff --from empty
```

DDL 使用列内 `CHECK` 和表内 `FOREIGN KEY`。手动执行时同样需要开启外键检查。已有数据库的结构升级请使用[版本化迁移](./migrations.md)。

### 写入

- `INSERT` 和 `UPDATE` 使用 `RETURNING` 获取实际写入的结果。
- 支持批量写入返回和原生 `ON CONFLICT DO UPDATE`，条件见 [upsert](../client/writes.md#upsert)。

### 事务与连接

所有请求共用一个同步连接，按到达顺序排队。同一客户端上的并发 Promise 不会同时执行 SQL，也不存在多连接并行读取。

| 场景                 | 语句                |
| -------------------- | ------------------- |
| 写事务               | `BEGIN IMMEDIATE`   |
| 只读事务             | `BEGIN`             |

- 隔离级别只能声明 `serializable`。
- `ROLLBACK` 失败后，连接被标记为不可用，后续请求报 `CLIENT_CLOSED`。
- 同步 API 会阻塞事件循环。在高并发或大数据量场景下，请结合实际负载验证。

通用行为见[事务](../client/transactions.md)。

### 错误映射

根据 SQLite 的约束消息映射为 `UNIQUE_CONSTRAINT`、`FOREIGN_KEY_CONSTRAINT`、`NOT_NULL_CONSTRAINT` 和 `CHECK_CONSTRAINT`，其余归为 `DATABASE_ERROR`。

### 相关链接

- [Node.js `node:sqlite` 文档](https://nodejs.org/api/sqlite.html)

## MySQL / MariaDB

基于 `mariadb` Node.js Promise 客户端。支持 MySQL 8.0 及以上和 MariaDB 10.6 及以上，受管理的表必须使用 InnoDB。适配器在启动时检查服务器版本和已有表的存储引擎。

### 连接

```ts
import { createClient } from './generated/client.ts';
import { mysql } from '@ofis/tsorm/adapters/mysql';

const db = await createClient({
  adapter: mysql({
    connection: {
      host: process.env.MYSQL_HOST,
      port: 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 10,
    },
  }),
});
```

| 选项         | 类型         | 默认值  | 说明                                   |
| ------------ | ------------ | ------- | -------------------------------------- |
| `connection` | `PoolConfig` | 必填    | `mariadb` 连接池配置，包括 SSL 和超时  |
| `initialize` | `boolean`    | `false` | 在空数据库中创建全部表，见下文         |

#### 固定的驱动选项

为保证结果能够正确解码，适配器固定了以下选项，`connection` 中的同名设置会被覆盖：

`dateStrings`、`timezone`、`autoJsonMap`、`bigIntAsNumber`、`insertIdAsNumber`、`multipleStatements`、`decimalAsNumber`

#### 会话设置

适配器为每个取出的连接设置 UTC 会话时区、严格写入模式和 `NO_BACKSLASH_ESCAPES`。

#### 身份验证

MySQL 8.4 默认使用 `caching_sha2_password`。生产环境应配置 TLS 或可信的服务端公钥（`cachingRsaPublicKey`）。适配器不会默认开启 `allowPublicKeyRetrieval`。

### 类型细节

- 无长度的 `string` 使用 `LONGTEXT`。需要索引、唯一约束或字符串主键时必须使用 `string(n)`，否则报 `UNSUPPORTED_CAPABILITY`。ORM 不会生成前缀索引。
- 建表固定使用 `utf8mb4_bin`。该排序规则的比较语义包括 `PAD SPACE`，应用层的关系分组也按此处理尾部空格。
- 已有数据库应采用生成 DDL 的类型和排序规则，ORM 不保证任意外部表结构上的查询行为等价。
- 日期年份必须在 1000 到 9999 之间。
- 整数和 `insertId` 保持驱动默认的 `bigint`，检查范围后再转换。

### 初始化

`initialize: true` 要求所选数据库为空，否则报 `DATABASE_NOT_EMPTY`。适配器先创建所有表和索引，再添加外键，因此支持循环模型引用。

::: danger DDL 不可回滚
MySQL 的 DDL 会隐式提交事务，初始化失败可能留下部分表，需要人工检查和清理。同一个数据库只由一个进程初始化。
:::

导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=mysql://user:pass@host:3306/app tsorm diff --from empty
```

手动执行时需要自行配置 `NO_BACKSLASH_ESCAPES`、严格写入模式和 UTC 时区。

已有数据库的结构升级请使用[版本化迁移](./migrations.md)。MySQL 的 DDL 无法回滚，迁移失败时已执行的语句会保留，见[失败与修复](./migrations.md#resolve)。迁移需要为影子库建库的权限，或设置 `SHADOW_DATABASE_URL`。

### 写入

- 由于没有 `RETURNING`，单条写入通过 `insertId` 和事务内的主键回读获取结果。
- `upsert` 在插入的记录只可能在 `where` 的唯一键上冲突时使用 `ON DUPLICATE KEY UPDATE`，否则在同一事务内先查询后写入，见 [upsert](../client/writes.md#upsert)。
- `createManyAndReturn` 在事务内逐条插入并按 `insertId` 读回；`updateManyAndReturn` 先选出匹配的主键，再逐条更新并读回。
- `skipDuplicates` 逐条执行并只捕获唯一冲突，以保证计数准确。
- 算术更新会逐条回读，以检查结果是否在安全整数范围内。

### 事务与连接

每个根请求从连接池独立获取连接，整个嵌套查询树或写入图使用同一连接。写入自动包裹事务，普通读取不会自动开启事务。

- 支持三种隔离级别，通过 `SET TRANSACTION ISOLATION LEVEL` 设置。
- 省略隔离级别时使用会话默认值（MySQL 为 `REPEATABLE READ`）。
- `ROLLBACK` 失败时销毁该连接，不放回连接池。
- `$close()` 会关闭适配器创建的连接池。

通用行为见[事务](../client/transactions.md)。

### 错误映射

| MySQL 错误号       | 错误码                   |
| ------------------ | ------------------------ |
| 1062               | `UNIQUE_CONSTRAINT`      |
| 1451、1452         | `FOREIGN_KEY_CONSTRAINT` |
| 1048               | `NOT_NULL_CONSTRAINT`    |
| 3819、4025         | `CHECK_CONSTRAINT`       |
| 1213               | `TRANSACTION_DEADLOCK`   |
| 1205               | `LOCK_TIMEOUT`           |
| 其他               | `DATABASE_ERROR`         |

### 相关链接

- [MariaDB Connector Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)
- [MariaDB Connector 连接选项](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## PostgreSQL

基于 `pg`（node-postgres）。支持 PostgreSQL 14 及以上，适配器在启动时检查服务器版本。

### 连接

```ts
import { createClient } from './generated/client.ts';
import { postgres } from '@ofis/tsorm/adapters/postgres';

const db = await createClient({
  adapter: postgres({
    connection: {
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    },
    dbSchema: 'public',
  }),
});
```

| 选项         | 类型         | 默认值   | 说明                                        |
| ------------ | ------------ | -------- | ------------------------------------------- |
| `connection` | `PoolConfig` | 必填     | `pg` 连接池配置，包括 SSL                   |
| `dbSchema`   | `string`     | `public` | 目标 schema，必须已存在，不能是系统 schema  |
| `initialize` | `boolean`    | `false`  | 在空 schema 中创建全部表，见下文            |

::: warning 类型解析器
不要在 `connection` 中替换 `pg` 的默认类型解析器，否则 `bigint` 可能在范围检查前就被舍入为 `number`。适配器不会全局修改 `pg.types`。
:::

#### 会话设置

适配器为每个取出的连接设置 `search_path`、UTC 时区和 `standard_conforming_strings`。

### 类型细节

- `int8` 和 `count` 默认以字符串返回，适配器检查范围后转换为 `number`。
- 布尔值使用原生 `BOOLEAN`，不附加取值 `CHECK`。
- 自增键使用 `GENERATED ALWAYS AS IDENTITY`，数据库层也会拒绝显式写入。
- 所有标识符限制在 63 个 UTF-8 字节以内，以避免被静默截断后重名。
- 索引大小仍受 PostgreSQL 实际索引条目大小限制。
- 排序显式使用 `ASC NULLS FIRST` 和 `DESC NULLS LAST`。
- `LIKE` 遵循 PostgreSQL 的大小写语义。

### 初始化

`initialize: true` 要求目标 schema 中没有表、视图和序列，否则报 `DATABASE_NOT_EMPTY`。目标 schema 不存在时报 `SCHEMA_NOT_FOUND`。

初始化在一个事务内运行，失败时回滚全部 DDL。它持有以数据库和 schema 为范围的 advisory lock：并发初始化时，后到者等待锁释放，然后因 schema 非空被拒绝。

`initialize` 不会删除已有表；结构升级请使用[版本化迁移](./migrations.md)。重新连接已有数据库时请省略。

导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=postgresql://user:pass@host:5432/app tsorm diff --from empty
```

手动执行时需要设置正确的 `search_path`，并启用 `standard_conforming_strings`。

已有数据库的结构升级请使用[版本化迁移](./migrations.md)。`DATABASE_URL` 的 `schema` 参数对应 `dbSchema`。迁移需要 `CREATEDB` 权限来创建影子库，或设置 `SHADOW_DATABASE_URL`。

### 写入

- `INSERT` 和 `UPDATE` 使用 `RETURNING` 获取实际写入的结果。
- 支持批量写入返回和原生 `ON CONFLICT DO UPDATE`，条件见 [upsert](../client/writes.md#upsert)。

### 事务与连接

每个根请求从连接池独立获取连接，整个嵌套查询树或写入图使用同一连接。写入自动包裹事务，普通读取不会自动开启事务。

- 支持三种隔离级别，通过 `BEGIN ISOLATION LEVEL` 设置。
- 省略隔离级别时使用会话默认值（PostgreSQL 为 `READ COMMITTED`），此时在事务内调用 `findManyAndCount` 报 `TRANSACTION_ISOLATION`。
- `ROLLBACK` 失败时丢弃该连接，不放回连接池。
- `$close()` 会关闭适配器创建的连接池。
- 适配器为连接池注册了 `error` 监听器，防止空闲连接故障变成未处理异常。这些错误不会额外输出日志。

通用行为见[事务](../client/transactions.md)。

### 错误映射

| SQLSTATE | 错误码                   |
| -------- | ------------------------ |
| `23505`  | `UNIQUE_CONSTRAINT`      |
| `23503`  | `FOREIGN_KEY_CONSTRAINT` |
| `23502`  | `NOT_NULL_CONSTRAINT`    |
| `23514`  | `CHECK_CONSTRAINT`       |
| `40001`  | `SERIALIZATION_FAILURE`  |
| `40P01`  | `TRANSACTION_DEADLOCK`   |
| `55P03`  | `LOCK_TIMEOUT`           |
| `57014`  | `QUERY_CANCELLED`        |
| `25P02`  | `TRANSACTION_ABORTED`    |
| 其他     | `DATABASE_ERROR`         |

### 相关链接

- [node-postgres：查询](https://node-postgres.com/features/queries)
- [node-postgres：事务](https://node-postgres.com/features/transactions)
- [node-postgres：连接池](https://node-postgres.com/features/pooling)
