---
description: 定义在客户端计算的类型化虚拟字段，包括依赖声明、select 与 omit 行为。
---

# 虚拟字段

虚拟字段在查询结果上同步计算，不写入数据库。字段值和返回类型都可以自动推导。虚拟字段通过 `$extend` 挂到客户端上，连接与运行时选项仍由 `createClient` 配置。

## 定义

```ts
import { createClient } from "./generated/client.ts";

const base = await createClient({ adapter });
const db = base.$extend({
  virtuals: {
    user: {
      displayName: {
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      },
    },
  },
});
```

| 属性      | 说明                                                          |
| --------- | ------------------------------------------------------------- |
| `needs`   | 计算所依赖的物理标量字段                                      |
| `compute` | 同步的纯函数；类型上是完整行，运行时只暴露 `needs` 声明的字段 |

## 跨模型共享

多个模型共享虚拟字段时，将字段定义提取为常量并在模型配置中复用；模型专属字段单独声明：

```ts
const shared = {
  emailDomain: {
    needs: { email: true },
    compute: (row: Readonly<{ email: string }>) => row.email.split("@")[1] ?? "",
  },
} as const;

const db = (await createClient({ adapter })).$extend({
  virtuals: {
    user: {
      ...shared,
      displayName: {
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      },
    },
    account: shared,
  },
});
```

- 共享常量是「字段名 → 定义」的映射，必须加 `as const`，否则 `needs` 里的 `true` 会被拓宽成 `boolean` 而报错。
- 共享常量是具名常量，`compute` 的参数需要手动注解为公共字段子集，且这些字段必须存在于每个使用它的模型。
- 内联的专属字段不需要注解，`compute` 的参数自动是所在模型的完整行。
- `needs` 声明的字段在扩展客户端时逐模型校验，缺失会报错。

扩展的完整语义（叠加、生命周期共享、链式扩展）见[扩展](./extensions.md)。

## 读取

默认的完整记录包含虚拟字段，也可以用 `select` 选择，或用 `omit` 排除：

```ts
const rows = await db.user.findMany({ select: { displayName: true } });
const others = await db.user.findMany({ omit: { displayName: true } });
```

依赖字段自动加载，结果按 `select` 返回。

## 规则

- `compute` 必须同步，返回 Promise 会被拒绝。
- 读取未声明的依赖会报错。
- 依赖只能是物理标量字段。依赖其他虚拟字段、循环依赖和名称冲突都会在扩展客户端时被拒绝。
- 虚拟字段只出现在查询结果中，不写入数据库。

## 下一步

- [扩展](./extensions.md)：叠加多组虚拟字段定义
- [查询](./queries.md)：在查询中选择与排除字段
