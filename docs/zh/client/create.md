---
description: 创建单条和多条记录，返回写入结果与数据库差异。
---

# 新增

`create` 返回实际写入的记录，接受 `select`、`include` 和 `omit`。更新见[更新](./update.md)，删除见[删除](./delete.md)。

## 单条新增

```ts
const user = await db.user.create({
  data: { email: "alice@example.com", name: "Alice" },
});
```

- `@auto` 主键由数据库生成，不能显式赋值。
- 默认值、`uuid()`、`now()` 和类型化 JSON 的应用方式与批量插入相同。
- 嵌套关系写入，包括 `connect` 和 `create`，在同一事务内完成，见[关系写入](./relation-writes.md)。
- 唯一键已存在时报 `UNIQUE_CONSTRAINT`；需要一次完成创建或更新时用 `upsert`，见 [upsert](./update.md#upsert)。

## createMany

```ts
const { count } = await db.user.createMany({
  data: [{ email: "a@example.com" }, { email: "b@example.com" }],
  skipDuplicates: true,
});
```

- 输入使用标量字段，关联通过外键传入，自增 ID 由数据库生成。
- 默认值、`uuid()`、`now()`、类型化 JSON 和软删除外键检查的行为与单条 `create` 相同。
- 使用多行 `INSERT`，按 900 个参数的预算分批。所有批次在同一事务内；除 `skipDuplicates` 跳过的唯一冲突外，其他错误都会回滚全部批次。
- 空输入返回 `{ count: 0 }`。
- `count` 是实际插入的记录数。启用 `skipDuplicates` 后，唯一冲突（包括批内重复）不计入，其他校验和外键错误仍会报错。

## createManyAndReturn

```ts
const created = await db.user.createManyAndReturn({
  data: [{ email: "c@example.com" }],
  select: { id: true, email: true },
});
```

- 支持 `select`、`include`、`omit` 和虚拟字段。
- 结果顺序不保证，需要时按业务键自行排序。
- 空输入返回空数组。

## 数据库差异

| 能力                  | SQLite                   | PostgreSQL               | MySQL / MariaDB            |
| --------------------- | ------------------------ | ------------------------ | -------------------------- |
| 多行 `INSERT`         | 支持                     | 支持                     | 支持                       |
| `skipDuplicates`      | `ON CONFLICT DO NOTHING` | `ON CONFLICT DO NOTHING` | 逐条执行，只捕获唯一冲突   |
| `createManyAndReturn` | `RETURNING`              | `RETURNING`              | 事务内逐条插入，按主键读回 |

MySQL / MariaDB 适配器不使用 `RETURNING`，所以 `createManyAndReturn` 需要额外语句：自增主键按 `insertId` 读回，其余记录按传入的单字段或复合主键读回。MySQL 不使用 `INSERT IGNORE`，以免吞掉无效值、非空或外键错误。

软删除模型的唯一约束包含已删除的记录，`skipDuplicates` 不会恢复它们。指向软删除模型的外键在去重前仍需通过引用校验，见[软删除](../schema/soft-delete.md)。

## 下一步

- [更新](./update.md)：修改已有记录，含 `upsert`
- [关系写入](./relation-writes.md)：在同一个事务中写入关联记录
- [软删除](../schema/soft-delete.md)：隐藏记录而不删除
