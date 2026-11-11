---
description: A VS Code extension providing syntax highlighting, formatting, completion, and diagnostics for .orm files.
---

# VS Code Extension

The extension adds editing support for `.orm` model files. It bundles its own parser and requires no ORM or database driver in your project.

## Features

- Syntax highlighting
- Document formatting that preserves comments, strings, trailing comments, and single blank lines between fields
- Live diagnostics based on the ORM parser
- Hover documentation with an example for every keyword
- Go to definition within the current file: models, the owner field named by `@via(x)`, and fields referenced from `@relation(field: x)`, `@@index(...)`, and similar attributes
- Completion for models, field types, attributes, default functions, relation fields, `@via`, `@relation` options, and typed JSON, each entry documented with a schema example

Field attributes are filtered by the field's type and shape, so a scalar field never offers `@relation` or `@via`.

### Relation Completion

While formatting, a relation field is paired with the owner side in the target model. The declared field becomes the inverse side and receives `@via(...)`:

| Declared field      | Owner side in the target model | Added                                              |
| ------------------- | ------------------------------ | -------------------------------------------------- |
| `posts: Post[]`     | `author: User`                 | `@via(author)` on `posts`                          |
| `profile?: Profile` | `user: User`                   | `@via(user)` on `profile`, and `@unique` on `user` |

A single inverse field must be optional and the owning foreign key must be unique, so an optional single field pairs as one-to-one and an array field pairs as one-to-many.

When an array relation has no back relation in the target model at all, the whole one-to-many relation is created: the target model gets the owner field, named after the declaring model in camel case, and the declaring side gets `@via(...)`. For example `entries: AccountEntry[] @via(account)` plus `account: Account` in the target model.

When a model declares a back relation with `@via(name)` and the target model has no `name` field yet, the owner side is created in the target model, for example `account: A`.

When the model already declares the column the parser would generate for a relation, the relation field gets `@relation(field: ...)`.

## Installation

Search for **TSORM** in the VS Code Extensions view and install it, or run from the command line:

```bash
code --install-extension ofis.tsorm
```

Requires VS Code 1.85 or later. The extension ID is `ofis.tsorm`.

## Format on Save

Add to `settings.json`:

```json
{
  "[tsorm]": {
    "editor.defaultFormatter": "ofis.tsorm",
    "editor.formatOnSave": true
  }
}
```

Formatting first attempts relation completion, then parses the result. If diagnostics remain and formatting fails, fix those errors first.

## Development

```bash
bun run build
bun test ./extensions/test
```

The extension version follows the `version` in the root `package.json`; `bun run build` copies it into the extension manifest.

To debug, launch VS Code with `extensions` as the Extension Development Path.

## Next Steps

- [Models and Fields](../schema/overview.md): the syntax the extension highlights and completes
- [Development & Validation](./development.md): how the extension is built and tested
