---
description: Composite constraints and keys, indexes, name mapping, and soft delete in schema.orm.
---

# Model Attributes

Model attributes are declared inside the model body and start with `@@`. They constrain the table as a whole rather than a single field.

## Composite Unique Constraints and Indexes

```ts
model Membership {
  id: int @id @auto
  organization: string(64)
  email: string

  @@unique(organization, email)
  @@index(email)
}
```

Querying by a composite unique key requires all fields, for example `where: { organization, email }`.

`@@id`, `@@unique` and `@@index` take comma-separated bare field names; brackets are rejected, so
`@@index([email])` fails with `Field lists take bare names, not brackets`. `@via` and `@@softDelete` also take bare field names.

`string` without a length is `string(191)`, so string fields can be indexed, made unique, or used as a string primary key without extra annotations; see [Why `string` Defaults to 191](./overview.md#why-string-defaults-to-191) for the reasoning behind that length. `text` is unbounded instead, and cannot be a key or indexed.

## Composite Primary Keys

Primary key fields are immutable through the ORM, including composite key components and their bound relations. Use a surrogate primary key and a unique business key when identifiers must change.

```ts
model Membership {
  account: Account
  group: Group
  role: "owner" | "member" = "member"

  @@id(account, group)
}
```

- `@@id` contains at least two non-nullable fields and may name relations, which stand for their foreign key fields.
- Querying by primary key requires all fields, for example `where: { accountId, groupId }`.
- A model with a composite primary key may reference other models, and other models may declare back collections to it with `@via`; but it cannot be referenced directly by another model's foreign key, and it cannot take part in a many-to-many relation.

## Surrogate Keys Instead of Composite Keys

Foreign keys can only reference a single-field primary key, and `@relation(field: ...)` names exactly one column. If a model may ever be referenced by another model, give it a surrogate key instead of `@@id`:

- Use a primary key with no business meaning: `id: int @id @auto`, or `bigint`, or `string(36) = uuid()`.
- Keep the former composite key as `@@unique(...)`, so the database still enforces it.
- Let other models reference the single `id` column.

### Line Items

A line item is identified by its order and line number. Declare that pair as a unique constraint, and a refund needs only one foreign key column, `lineId`:

```ts
model Order {
  id: int @id @auto
  lines: OrderLine[] @via(order)
}

model OrderLine {
  id: int @id @auto
  order: Order @relation(onDelete: Cascade)
  lineNo: int
  quantity: int
  refunds: Refund[] @via(line)

  @@unique(order, lineNo)
}

model Refund {
  id: int @id @auto
  line: OrderLine
  amount: decimal(10, 2)
}
```

Look a line up by its business key with all fields of the unique key, for example `where: { orderId, lineNo }`. Renumbering lines later does not affect foreign keys that point at them.

### Associations with Extra Fields

An implicit many-to-many join table holds only the two foreign keys. When the association carries its own data, such as a role or a join date, declare it as a regular model with a one-to-many relation from each side:

```ts
model User {
  id: int @id @auto
  memberships: Membership[] @via(user)
}

model Group {
  id: int @id @auto
  memberships: Membership[] @via(group)
}

model Membership {
  id: int @id @auto
  user: User
  group: Group
  role: "owner" | "member" = "member"
  joinedAt: datetime = now()

  @@unique(user, group)
}
```

Unlike the [composite primary key](#composite-primary-keys) version, this `Membership` can itself be referenced, for example by `membership: Membership` in an audit log. To get from a user to its groups, go through `memberships` and then `group`.

### Multi-Tenancy

A child model stores both the tenant and its parent, so filtering by tenant needs no join:

```ts
model Tenant {
  id: int @id @auto
  slug: string(64) @unique
}

model Project {
  id: int @id @auto
  tenant: Tenant
  key: string(16)
  tasks: Task[] @via(project)

  @@unique(tenant, key)
}

model Task {
  id: int @id @auto
  tenant: Tenant
  project: Project
  title: string(200)

  @@index(tenant, project)
}
```

::: warning Cross-table consistency is up to the application
A composite foreign key `(tenantId, projectId)` would let the database guarantee that a task and its project belong to the same tenant. With single-column foreign keys the database only checks that `projectId` exists, not that `task.tenantId` equals `project.tenantId`. When creating a task, read the tenant from the project instead of accepting both from the caller.
:::

The cost of surrogate keys is an extra `id` column and index per table, plus cross-table rules like the one above that the application has to enforce.

## Name Mapping

`@map` and `@@map` set the column and table names in the database; client code still uses the names from the model:

```ts
model Account {
  id: int @id @auto
  email: string @unique @map("email_address")
  createdAt: datetime = now() @map("created_at")

  @@map("accounts")
}
```

Migrations follow database names: renaming a field while keeping `@map` produces no migration, while changing the `@map` value drops the old column and adds a new one. Raw SQL must use the database names.

## Soft Delete

`@@softDelete(field)` selects a nullable `datetime` or `timestamp` management field. `@@softDelete()` defaults to `deletedAt` and adds `deletedAt?: datetime` when absent. See [Soft Delete](./soft-delete.md) for declaration constraints, visibility, and relation behavior.

## Type Declarations

Top-level `type` declarations describe `json<T>` values; they are not model attributes. They drive generated types and runtime JSON validation, not physical columns. See [Typed JSON](./json.md) for declarations and existing-data migration requirements.

## Next Steps

- [Models and Fields](./overview.md): field types, defaults, and field attributes
- [Relations](./relations/overview.md): one-to-many, one-to-one, many-to-many, and polymorphic relations
