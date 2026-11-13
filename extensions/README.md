# TSORM for VS Code

Language support for `.orm` model files, with a built-in parser — no ORM install needed in your project.

- **Highlighting & diagnostics**: validation as you type, errors pinpointed to the exact word, multiple statements reported at once.
- **Formatting**: consistent indentation and line breaks, preserving comments and blank lines.
- **Relation completion**: formatting fills in missing `@via`, `@unique`, `@relation(field: ...)` and owner fields; also available as a quick fix on diagnostics, or disable with `tsorm.format.completeRelations`.
- **Completion**: types, attributes, fields, referential actions and JSON type aliases, based on cursor position.
- **Hover & go to definition**: model fields, aliases and field declarations; `F12` jumps to models, aliases or referenced fields.
- **Symbols & refactoring**: outline and workspace symbol search; find references and rename for models, aliases and fields (`Shift+F12`, `F2`).

## Relation Completion

```tsorm
model User {
  id: int @id @auto
  posts: Post[]              // after formatting: posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  author: User
}
```

For many-to-many, declare arrays on both sides.

## Format on Save

```json
"[tsorm]": { "editor.formatOnSave": true }
```

For layout-only formatting without relation completion:

```json
"tsorm.format.completeRelations": false
```

---

## 中文

`.orm` 模型文件的语言支持，内置解析器，无需在项目里安装 ORM。

- **高亮与诊断**：边写边校验，错误定位到具体单词，不同语句的错误一次报出。
- **格式化**：统一缩进和换行，保留注释与空行。
- **补全关系**：格式化时自动补上缺少的 `@via`、`@unique`、`@relation(field: ...)` 和持有方字段；也可从诊断的快速修复触发，或用 `tsorm.format.completeRelations` 关闭。
- **输入提示**：类型、属性、字段、外键动作、JSON 类型别名，按光标位置给出。
- **悬停与跳转**：查看模型字段、别名与字段声明，`F12` 跳到模型、别名或被引用的字段。
- **符号与重构**：大纲与工作区符号搜索；模型、别名与字段的查找引用和重命名（`Shift+F12`、`F2`）。

### 补全关系

```tsorm
model User {
  id: int @id @auto
  posts: Post[]              // 格式化后：posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  author: User
}
```

需要多对多时两侧都写数组。

### 保存时格式化

```json
"[tsorm]": { "editor.formatOnSave": true }
```

只想调整排版、不自动补全关系时：

```json
"tsorm.format.completeRelations": false
```