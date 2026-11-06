---
description: Field types, defaults, relations, constraints, indexes, and name mapping syntax for schema.orm.
---

# Schema

`schema.orm` describes models with TypeScript-flavored syntax. The generator turns it into client types and table DDL.

## Models and Fields

Every model must have a primary key: use `@id` for a single-field key and `@@id` for a composite key.

```ts
model User {
  id: int @id @auto
  email: string(191) @unique
  name?: string
  enabled: boolean = true
  createdAt: date = now()
}
```

The full form of a field is `name[?]: type [= default] [attributes...]`, with attributes written after the default value:

```ts
model Token {
  id: string(36) = uuid() @id
  value: string
}
```

### Field Types

| Type                | Description                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `int`               | Integer within the JavaScript safe-integer range, read back as `number`                         |
| `bigint`            | 64-bit integer, read back as JavaScript `bigint`; writes accept `bigint` or a safe integer      |
| `number`            | Finite floating-point number                                                                    |
| `decimal(p, s)`     | Fixed-point decimal, read and written as strings to avoid precision loss; numbers also accepted. `p` ranges from 1 to 65, `s` from 0 to 30 |
| `string`            | Unbounded string                                                                                |
| `string(n)`         | Bounded string, `n` ranges from 1 to 16383, counted by Unicode code points                      |
| `boolean`           | Boolean value                                                                                   |
| `date`              | Local date-time, returned as a millisecond-precision string, see [Date & Timezone](../client/datetime.md) |
| `"a" \| "b"`        | String literal union, enforced by a database `CHECK` constraint                                 |
| `json<T>`           | Typed JSON, see [Typed JSON](../client/json.md)                                                 |
| `bytes`             | Binary data, read and written as `Uint8Array`; cannot be a key or index                         |

A `?` after the field name makes it nullable, defaulting to `NULL`. Physical type mappings are listed in [Type Mapping](../databases/overview.md#type-mapping).

Writing a `decimal` value that exceeds the declared precision or scale raises `VALIDATION`; values are never silently rounded. Omitting `(p, s)` places no digit limits. SQLite has no fixed-point type, so `decimal` is stored as a float and is accurate up to about 15 significant digits.

Both `int` and `bigint` map to `BIGINT` in MySQL and PostgreSQL; they differ only in the JavaScript type, so switching between them requires no migration.

### Defaults

| Form                | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `= literal`         | Fixed default value, must match the field type                           |
| `= now()`           | Current time in the client timezone, only for `date`                     |
| `= uuid()`          | Generates a UUID, only for strings of length at least 36                 |

`date` fields only accept `now()`, and JSON fields only accept `null` as a default.

### Field Attributes

| Attribute                 | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `@id`                     | Single-field primary key                                                                      |
| `@auto`                   | Auto-generated ID, only for `int @id` or `bigint @id` without a default value                 |
| `@unique`                 | Single-field unique constraint                                                                |
| `@updatedAt`              | Set to the current time on create and every update, only for `date` without a default value   |
| `@map("name")`            | Column name in the database, see [Name Mapping](#name-mapping)                                |
| `@via(field)`             | Declares the field on the other model that the back relation points to                        |
| `@relation(...)`          | Binds one explicit foreign key field and configures referential actions, see [Referential Actions](#referential-actions) |

`@updatedAt` fields may be omitted on create. On any ORM update (`updateMany`, `upsert`, and nested updates included), the field is set to the current time whenever a field is written; an explicit value always wins. Soft delete and restore leave it unchanged.

## Relations

A field whose type is another model is a relation field. Every relation has an **owning side**: for one-to-many and one-to-one it holds the foreign key column, and for many-to-many it declares the join table. The other side can declare an **inverse field** with `@via` to navigate back. Inverse fields add no columns.

| Relation     | Owning side            | Inverse field                   | Database structure        |
| ------------ | ---------------------- | ------------------------------- | ------------------------- |
| One-to-many  | `author: User`         | `posts: Post[] @via(author)`    | `Post.authorId`           |
| One-to-one   | `user: User @unique`   | `profile?: Profile @via(user)`  | Unique `Profile.userId`   |
| Many-to-many | `tags: Tag[]`          | `posts: Post[] @via(tags)`      | Join table `_Post_tags`   |

For reading and writing relations, see [Queries](../client/queries.md#relation-filters) and [Relation Writes](../client/relation-writes.md).

### One-to-Many

```ts
model User {
  id: int @id @auto
  email: string(191) @unique
  posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  title: string
  author: User
  reviewer?: User
}
```

- `author` is a required relation and generates `authorId`. `reviewer` is optional and generates a nullable `reviewerId` that defaults to `NULL`.
- `posts` is the inverse field; `@via(author)` points at the owning field on `Post`.
- The foreign key column is named after the relation followed by the target's primary key name, capitalized, and has the same type and length as that key. When the target key is `code: string(2) @id`, `country: Country` generates `countryCode: string(2)`.
- Foreign keys appear in the client next to their relation and work directly in filters and writes, for example `where: { authorId: 1 }`.

`@@unique`, `@@index`, and `@@id` accept a relation name, meaning its foreign key column:

```ts
model Post {
  id: int @id @auto
  author: User
  slug: string(64)

  @@unique(author, slug)
}
```

### One-to-One

Add `@unique` on the owning side, which puts a unique constraint on the foreign key column. Write the inverse as an optional single field:

```ts
model User {
  id: int @id @auto
  profile?: Profile @via(user)
}

model Profile {
  id: int @id @auto
  bio: string = ""
  user: User @unique
}
```

Put the foreign key on the dependent side: a user exists before their profile, so `Profile` holds `userId`. The owning side can be optional too; `user?: User @unique` lets a profile exist without a user for a while.

### Many-to-Many

The owning side is an array field without `@via`, and the ORM creates an implicit join table for it:

```ts
model Post {
  id: int @id @auto
  title: string
  tags: Tag[]
}

model Tag {
  id: int @id @auto
  name: string(191) @unique
  posts: Post[] @via(tags)
}
```

- The join table is named `_Model_field`, here `_Post_tags`. Its two columns, `sourceId` (to `Post`) and `targetId` (to `Tag`), form its primary key.
- Deleting a record on either side deletes its links in the join table.
- When the link itself carries data such as a role or a join date, connect the two sides through an ordinary model instead; see [Associations with Extra Fields](#associations-with-extra-fields).

### Declaring the Foreign Key Field

To control the foreign key column yourself, declare the field and bind it with `@relation(field: ...)`:

```ts
model Post {
  id: int @id @auto
  authorId: int @map("author_id")
  author: User @relation(field: authorId)
}
```

- The field has the same type and length as the target's primary key, and its nullability matches the relation: an optional relation takes a nullable field.
- It is an ordinary scalar field, so it can carry `@map` or `@unique`; it cannot be `@id`, `@auto`, or an enum.
- When the model already has a field with the generated name, such as `authorId` above, bind it with `field`.
- Each foreign key field belongs to exactly one relation.

### Referential Actions

`onDelete` and `onUpdate` on `@relation` decide what happens to referencing records when the referenced record is deleted or its primary key changes:

```ts
model Post {
  id: int @id @auto
  author: User @relation(onDelete: Cascade)
  editor?: User @relation(onDelete: SetNull)
}
```

| Action     | Behavior                                                 |
| ---------- | -------------------------------------------------------- |
| `Restrict` | Rejects the operation while references exist; the default |
| `NoAction` | Rejects the operation while references exist, checked at the end of the statement |
| `Cascade`  | Deletes the referencing records, or updates their foreign keys |
| `SetNull`  | Sets the foreign key to `NULL`; for optional relations   |

- The database carries out referential actions, so they apply to raw SQL as well.
- Primary keys rarely change, so `onUpdate` can usually stay at its default.
- [Soft delete](#soft-delete) only sets a deletion time and triggers no referential action.
- Join table links are always deleted together with either side.

### One-Way Relations

Declare inverse fields only where you need them. If you only navigate from a post to its author, `User` can leave out `posts`:

```ts
model User {
  id: int @id @auto
}

model Post {
  id: int @id @auto
  author: User
}
```

The database structure is identical to the two-way version, and adding the inverse later produces no migration.

### Self-Relations

A relation can target its own model. A tree uses an optional parent and an inverse collection of children:

```ts
model Category {
  id: int @id @auto
  name: string(64)
  parent?: Category @relation(onDelete: SetNull)
  children: Category[] @via(parent)
}
```

Self-referencing many-to-many works the same way, for example followers:

```ts
model User {
  id: int @id @auto
  following: User[]
  followers: User[] @via(following)
}
```

### Several Relations Between Two Models

Two models can share several relations. Each owning field generates its own foreign key, and each inverse names its counterpart with `@via`:

```ts
model User {
  id: int @id @auto
  authored: Post[] @via(author)
  reviewed: Post[] @via(reviewer)
}

model Post {
  id: int @id @auto
  author: User
  reviewer?: User
}
```

### Quick Reference

| Field                               | Allowed syntax                                       |
| ----------------------------------- | ---------------------------------------------------- |
| Single relation field (owning side) | `?`, `@unique`, `@relation(field, onDelete, onUpdate)` |
| Array field (many-to-many owner)    | No attributes                                        |
| Inverse field                       | Only `@via(owningField)`; a single inverse is optional, an array inverse is required |

Relation targets use a single-field primary key. For models with a natural composite key, see [Surrogate Keys Instead of Composite Keys](#surrogate-keys-instead-of-composite-keys).

## Model Attributes

### Composite Unique Constraints and Indexes

```ts
model Membership {
  id: int @id @auto
  organization: string(64)
  email: string(191)

  @@unique(organization, email)
  @@index(email)
}
```

Querying by a composite unique key requires all fields, for example `where: { organization, email }`.

`@@id`, `@@unique` and `@@index` take comma-separated bare field names; brackets are rejected, so
`@@index([email])` fails with `Field lists take bare names, not brackets`. `@via` and `@@softDelete` also take bare field names.

::: warning MySQL indexes
In MySQL, an unbounded `string` cannot be indexed or made unique; use `string(n)` instead. Otherwise initialization fails with `UNSUPPORTED_CAPABILITY`.
:::

### Composite Primary Keys

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

### Surrogate Keys Instead of Composite Keys

Foreign keys can only reference a single-field primary key, and `@relation(field: ...)` names exactly one column. If a model may ever be referenced by another model, give it a surrogate key instead of `@@id`:

- Use a primary key with no business meaning: `id: int @id @auto`, or `bigint`, or `string(36) = uuid()`.
- Keep the former composite key as `@@unique(...)`, so the database still enforces it.
- Let other models reference the single `id` column.

#### Line Items

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

#### Associations with Extra Fields

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
  joinedAt: date = now()

  @@unique(user, group)
}
```

Unlike the [composite primary key](#composite-primary-keys) version, this `Membership` can itself be referenced, for example by `membership: Membership` in an audit log. To get from a user to its groups, go through `memberships` and then `group`.

#### Multi-Tenancy

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

### Name Mapping

`@map` and `@@map` set the column and table names in the database; client code still uses the names from the model:

```ts
model Account {
  id: int @id @auto
  email: string(191) @unique @map("email_address")
  createdAt: date = now() @map("created_at")

  @@map("accounts")
}
```

Migrations follow database names: renaming a field while keeping `@map` produces no migration, while changing the `@map` value drops the old column and adds a new one. Raw SQL must use the database names.

### Soft Delete

```ts
model Account {
  id: int @id @auto
  deletedAt?: date

  @@softDelete(deletedAt)
}
```

Omitting the argument uses `deletedAt`, and the field is added when the model does not declare it:

```ts
model Account {
  id: int @id @auto

  @@softDelete()
}
```

The management field must be a nullable `date`, and cannot be a primary or unique key. Naming a field the model does not have fails. Behavior is described in [Soft Delete](../client/soft-delete.md).

## Type Declarations

`type` declarations describe JSON structures:

```ts
type Preferences = {
  theme: "light" | "dark"
  notifications: boolean
  languages: string[]
}

model Account {
  id: int @id @auto
  role: "admin" | "member" = "member"
  preferences?: json<Preferences>
}
```

## Reserved Names

Models and fields cannot use reserved names, including `AND`, `OR`, `NOT`, `_count`, `constructor`, `prototype`, and `__proto__`, nor can they start with `$`. Field names also cannot start with `__orm_`.

Validate a schema file with [`tsorm validate`](../reference/cli.md#commands); syntax errors include line and column numbers.
