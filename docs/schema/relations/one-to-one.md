---
description: Declare a one-to-one relation in schema.orm, put the unique foreign key on the dependent side, and write the inverse as an optional field.
---

# One-to-One

A one-to-one relation links two rows that stand for the same thing: a user and its profile, an order and its receipt. At most one row on each side may point at the other. On the database this is an ordinary foreign key column with a unique constraint.

## Definition

Declare `user: User @unique` on the owning side to make the generated `userId` unique. The inverse is optional: `profile?: Profile @via(user)`. With an [explicit foreign key](./foreign-keys.md), uniqueness may be declared on the bound scalar column; relation-level `@unique` also makes that column unique.

Everything else follows the [one-to-many rules](./one-to-many.md#definition): the column name is the relation name plus the capitalized target key, and the type and length are copied from the target's primary key.

## Example

```ts
model User {
  id: int @id @auto
  email: string @unique
  profile?: Profile @via(user)
}

model Profile {
  id: int @id @auto
  bio: string = ""
  user: User @unique
}
```

The foreign key lives on the dependent side: a user exists before their profile, so `Profile` holds `userId`. The relation reads the same way as any other one:

```ts
const user = await db.user.findUniqueOrThrow({
  where: { id: 1 },
  include: { profile: true },
});
```

## Notes

- The owning side may also be optional: `user?: User @unique` lets a profile exist without a user for a while. The unique constraint still applies, so two profiles can never share the same user.
- Foreign-key uniqueness determines the inverse cardinality. Without a unique foreign key, several profiles may reference the same user.
- The inverse field must be optional, because the owning side may not exist yet: `profile: Profile @via(user)` is rejected.
- An owning foreign key cannot reference a composite primary key; use a surrogate key instead, see [Surrogate Keys Instead of Composite Keys](../attributes.md#surrogate-keys-instead-of-composite-keys).
- The unique constraint lives in the database, so raw SQL sees it too.

## Next Steps

- [Many-to-Many](./many-to-many.md): when both sides own a collection of the other
- [Foreign Key Fields](./foreign-keys.md): declare the unique column yourself
