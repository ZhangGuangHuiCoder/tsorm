---
description: 按用途分组的 tsorm 全部命令的常用命令行示例。
---

# 命令示例

以下示例假定已设置 `DATABASE_URL`；未设置时，迁移类命令使用默认的本地 SQLite 文件 `file:./dev.db`。迁移名格式为 `<YYYYMMDDHHMMSS>_<slug>`，即去掉 `.sql` 扩展名的文件名。

## 迁移命令

### migrate

根据模型变更生成迁移并应用：

```bash
tsorm migrate                                # 生成并立即应用，名称默认 init/update
tsorm migrate --name add_profile             # 指定迁移名称
tsorm migrate --name add_tags --create-only  # 只生成迁移文件，不应用
```

`--create-only` 仍会进行此前的漂移/重置处理并应用已有待执行迁移，见[选项](./options.md)。

从空库重建数据库，丢弃全部数据：

```bash
tsorm migrate --reset --force
```

### deploy

应用待执行的迁移，例如在发布流水线中：

```bash
tsorm deploy
```

只做就绪检查而不应用任何迁移；数据库不是最新时退出码为 `1`：

```bash
tsorm deploy --check
```

### resolve

`resolve` 只修改历史记录，不执行迁移文件中的 SQL，也不撤销 DDL；还可用于基线登记。迁移失败后按处理方式选择：

```bash
tsorm resolve --applied 20260109120000_add_tags       # 已手动补完，标记为已应用
tsorm resolve --rolled-back 20260109120000_add_tags   # 已撤销部分变更，标记为已回滚供 deploy 重试
```

## 同步命令

### diff

输出两份结构之间的 SQL，不改动目标业务库，但可能使用[影子库](../../databases/migrations.md#影子库)。`--from` 接受 `migrations`、`database` 或 `empty`；`--to` 接受 `schema` 或 `database`：

```bash
tsorm diff                          # 迁移历史 → 模型
tsorm diff --from database          # 实库 → 模型
tsorm diff --from empty > init.sql  # 完整建表 SQL
```

只输出摘要，有差异时退出码为 `2`：

```bash
tsorm diff --check
```

### push

不经迁移文件，直接把数据库同步到与模型一致，适合本地原型验证：

```bash
tsorm push                            # 直接同步结构差异
tsorm push --reset --force            # 先清空数据库再同步
```

## 模型工具命令

### validate

校验模型文件并报告模型数量：

```bash
tsorm validate                            # 校验默认 schema.orm
tsorm validate --schema ./db/schema.orm   # 校验指定文件
```

### generate

生成客户端，默认写入 `generated/client.ts`：

```bash
tsorm generate
tsorm generate --schema ./db/schema.orm --out ./src/db/client.ts  # 指定模型文件与输出路径
```

## 下一步

- [选项与行为](./options.md)：每个选项的作用与确认时机
- [版本化迁移](../../databases/migrations.md)：`migrate`、`deploy`、`resolve` 背后的迁移流程
