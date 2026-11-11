---
description: Common command-line invocations for every tsorm command, grouped by purpose.
---

# Command Examples

The examples assume `DATABASE_URL` is already set; when it is not, the migration commands use the default local SQLite file `file:./dev.db`. Migration names are `<YYYYMMDDHHMMSS>_<slug>`, the file name without its `.sql` extension.

## Migration Commands

### migrate

Generate a migration from model changes and apply it:

```bash
tsorm migrate                                # generate and apply, named init/update by default
tsorm migrate --name add_profile             # name the migration
tsorm migrate --name add_tags --create-only  # write the file without applying it
```

`--create-only` still performs earlier drift/reset checks and applies existing pending migrations; see [Options](./options.md).

Rebuild the database from an empty state, discarding all data:

```bash
tsorm migrate --reset --force
```

### deploy

Apply pending migrations, for example in a release pipeline:

```bash
tsorm deploy
```

Check readiness without applying anything; exits `1` when the database is not up to date:

```bash
tsorm deploy --check
```

### resolve

`resolve` edits history without executing migration-file SQL or undoing DDL. It also supports baseline registration. After a failure, record it by outcome:

```bash
tsorm resolve --applied 20260109120000_add_tags       # finished by hand, record as applied
tsorm resolve --rolled-back 20260109120000_add_tags   # partial changes already undone; allow deploy to retry
```

## Sync Commands

### diff

Print the SQL between two sources without modifying the target business database. It may use a [shadow database](../../databases/migrations.md#shadow-database). `--from` accepts `migrations`, `database`, or `empty`; `--to` accepts `schema` or `database`:

```bash
tsorm diff                          # migration history -> models
tsorm diff --from database          # live database -> models
tsorm diff --from empty > init.sql  # full table-creation SQL
```

Summarize differences only, exiting `2` when there are any:

```bash
tsorm diff --check
```

### push

Bring the database in line with the models directly, without migration files. Suited to local prototyping:

```bash
tsorm push                            # sync the structure differences directly
tsorm push --reset --force            # clear the database first, then sync
```

## Schema Tooling Commands

### validate

Check the schema file and report the model count:

```bash
tsorm validate                            # check the default schema.orm
tsorm validate --schema ./db/schema.orm   # check a specific file
```

### generate

Write the client to the default `generated/client.ts`:

```bash
tsorm generate
tsorm generate --schema ./db/schema.orm --out ./src/db/client.ts  # choose the schema and output path
```

## Next Steps

- [Options & Behavior](./options.md): what each flag does and when a confirmation is asked
- [Versioned Migrations](../../databases/migrations.md): the migration workflow behind `migrate`, `deploy`, and `resolve`
