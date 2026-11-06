---
description: 定义在客户端计算的类型化虚拟字段。
---

# 虚拟字段

虚拟字段在查询结果上同步计算，不写入数据库。字段值和返回类型都可以自动推导。

## 定义

```ts
import { virtualField } from '@ofis/tsorm';
import { createClient, type AccountRow } from './generated/client.ts';

const define = virtualField<AccountRow>();

const db = await createClient({
  adapter,
  virtuals: {
    account: {
      displayName: define({
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      }),
    },
  },
});
```

| 属性      | 说明                                 |
| --------- | ------------------------------------ |
| `needs`   | 计算所依赖的物理标量字段             |
| `compute` | 同步的纯函数，参数只包含声明的依赖   |

## 读取

默认的完整记录包含虚拟字段，也可以用 `select` 选择，或用 `omit` 排除：

```ts
const rows = await db.account.findMany({ select: { displayName: true } });
const others = await db.account.findMany({ omit: { displayName: true } });
```

依赖字段会被自动加载，但不会出现在 `select` 的结果中。

## 规则

- `compute` 必须同步，返回 Promise 会被拒绝。
- 读取未声明的依赖会报错。
- 依赖只能是物理标量字段。依赖其他虚拟字段、循环依赖和名称冲突都会在创建客户端时被拒绝。
- 虚拟字段只出现在查询结果中，不写入数据库。
