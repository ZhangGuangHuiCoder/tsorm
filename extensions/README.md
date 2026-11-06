# TSORM for VS Code

`.orm` 模型文件的语言支持，内置解析器，无需在项目里安装 ORM。

- **高亮与诊断**：边写边校验，错误定位到具体单词。
- **格式化**：统一缩进和换行，保留注释与空行。
- **补全关系**：格式化时自动补上缺少的 `@via`、`@unique`、`@relation(field: ...)` 和持有方字段。
- **输入提示**：类型、属性、字段、外键动作，按光标位置给出。
- **悬停与跳转**：查看模型字段，`F12` 跳到模型或被引用的字段。

## 补全关系

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

## 保存时格式化

```json
"[tsorm]": { "editor.formatOnSave": true }
```
