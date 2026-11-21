---
description: A VS Code extension providing syntax highlighting, formatting, completion, and diagnostics for .orm files.
---

# VS Code Extension

The extension adds editing support for `.orm` model files. It bundles its own parser and needs no ORM or database driver in your project.

## Features

- Syntax highlighting
- Document formatting that preserves comments, strings, trailing comments, and single blank lines between fields
- Live diagnostics from the ORM parser (several errors at once when in different statements), with quick fixes that complete missing relation declarations without formatting the file
- Hover documentation with an example for every keyword, plus model field lists, JSON type aliases, and field declarations
- Go to definition within the current file: models, JSON type aliases, the owner field named by `@via(x)`, and fields referenced from `@relation(field: x)`, `@@index(...)`, and similar attributes
- Completion for models, JSON type aliases, field types, attributes, default functions, relation fields, `@via`, `@relation` options, and typed JSON, each entry documented with a schema example
- Outline and breadcrumbs: models with their fields, plus JSON type aliases, within the current `.orm` file
- Find all references and rename for models, JSON type aliases, and fields, covering `@via`, `@relation(field: ...)`, `morph(...)` bindings, and model-level attributes across the workspace

Field attributes are filtered by the field's type and shape, so a scalar field never offers `@relation` or `@via`.

### Relation Completion

While formatting, a relation field is paired with the owner side in the target model. The declared field becomes the inverse side and receives `@via(...)`:

| Declared field      | Owner side in the target model | Added                                              |
| ------------------- | ------------------------------ | -------------------------------------------------- |
| `posts: Post[]`     | `author: User`                 | `@via(author)` on `posts`                          |
| `profile?: Profile` | `user: User`                   | `@via(user)` on `profile`, and `@unique` on `user` |

A single inverse field must be optional and the owning foreign key must be unique: optional single fields pair as one-to-one, array fields as one-to-many.

With no back relation at all, the whole one-to-many relation is created — the target model gets an owner field named after the declaring model in camel case, and the declaring side gets `@via(...)`, e.g. `entries: AccountEntry[] @via(account)` plus `account: Account`.

A `@via(name)` back relation with no matching field yet creates the owner side in the target model, e.g. `account: A`. If the model already declares the column the parser would generate, the relation field gets `@relation(field: ...)`.

## Installation

Requires VS Code 1.85 or later; the extension ID is `ofis.tsorm`. Search for **TSORM** in the VS Code Extensions view and install it, or run from the command line:

```bash
code --install-extension ofis.tsorm
```

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

Formatting first attempts relation completion, then parses the result; fix any remaining diagnostics first. To keep formatting layout-only, disable relation completion:

```json
{
  "tsorm.format.completeRelations": false
}
```

## Development

```bash
bun run build
bun test ./extensions/test
```

The extension version follows the `version` in the root `package.json`; `bun run build` copies it into the extension manifest. To debug, launch VS Code with `extensions` as the Extension Development Path.

## Next Steps

- [Models and Fields](../schema/overview.md): the syntax the extension highlights and completes
- [Development & Validation](./development.md): how the extension is built and tested
