---
description: A VS Code extension providing syntax highlighting, formatting, completion, and diagnostics for .orm files.
---

# VS Code Extension

The extension adds editing support for `.orm` model files. It bundles its own parser and requires no ORM or database driver in your project.

## Features

- Syntax highlighting
- Document formatting that preserves comments, strings, trailing comments and single blank lines between fields
- Relation completion while formatting: a relation field is paired with the owner side by cardinality — an array field becomes a one-to-many back relation (`posts: Post[] @via(author)`) and an optional single field becomes a one-to-one back relation (`profile?: Profile @via(user)`, with `@unique` added to the owner side); when an array relation has no back relation in the target model at all, the whole one-to-many relation is created (`entries: AccountEntry[] @via(account)`, plus `account: Account` in the target model, the owner field named after the declaring model in camel case); when a model declares a back relation with `@via(name)` and the target model has no `name` field yet, the owner side is created in the target model (`account: A`); when the model already declares the column the parser would generate for a relation, the relation field gets `@relation(field: ...)`
- Completion for models, field types, attributes, default functions, relation fields, `@via`, `@relation` options and typed JSON, each entry documented with a schema example; field attributes are filtered by the field's type and shape (a scalar field never offers `@relation` or `@via`)
- Live diagnostics based on the ORM parser
- Hover documentation with an example for every keyword
- Go to definition within the current file: models, the owner field named by `@via(x)`, and fields referenced from `@relation(field: x)`, `@@index(...)` and similar attributes

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

When the model has syntax errors, fix the diagnostics before formatting.

## Development

```bash
bun run build
bun test ./test/vscode
```

The extension version follows the `version` in the root `package.json`; `bun run build` copies it into the extension manifest.

To debug, launch VS Code with `extensions` as the Extension Development Path.
