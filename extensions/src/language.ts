import { parseSchema } from "../../src/schema/index.js";
export interface Token {
  text: string;
  start: number;
  end: number;
}
/** 未闭合的块注释和字符串一直延伸到文本末尾，补全时据此判断光标是否落在其中。 */
export function tokens(source: string): Token[] {
  const pattern = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*(?:"|$)|-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|[^\s]/g;
  return [...source.matchAll(pattern)].map((m) => {
    return {
      text: m[0],
      start: m.index,
      end: m.index + m[0].length,
    };
  });
}
const isComment = (text: string) => {
  return text.startsWith("//") || text.startsWith("/*");
};
const isIdent = (text: string | undefined) => {
  return !!text && /^[A-Za-z_$]/.test(text);
};
/** 第 i 个 token 是否开始一个字段声明：`name:` 或 `name?:`。 */
const startsField = (list: Token[], i: number) => {
  return isIdent(list[i]?.text) && (list[i + 1]?.text === ":" || (list[i + 1]?.text === "?" && list[i + 2]?.text === ":"));
};
/** 两个 token 之间是否隔着空行。 */
const blankBetween = (gap: string) => {
  return /\n[\t ]*\r?\n/.test(gap);
};
export function formatSchema(source: string, indent = "  ", eol = "\n"): string {
  parseSchema(source);
  const list = tokens(source);
  const inside = jsonSpans(list);
  const lines: string[] = [];
  let line = "";
  let depth = 0;
  let parens = 0;
  let brackets = 0;
  /** 下一行之前是否要空一行：顶层声明之间固定一行，声明内部保留用户写的空行。 */
  let blank = false;
  /** 刚输出了文件开头或 `{` 行，紧随其后的空行没有意义。 */
  let fresh = true;
  const flush = () => {
    const text = line.trim();
    line = "";
    if (!text) {
      return;
    }
    if (blank && !fresh) {
      lines.push("");
    }
    blank = fresh = false;
    lines.push(indent.repeat(depth) + text);
  };
  const append = (text: string, tight: boolean) => {
    line += (line && !tight && !line.endsWith(" ") ? " " : "") + text;
  };
  for (let i = 0; i < list.length; i++) {
    const text = list[i].text;
    const previous = list[i - 1]?.text;
    const gap = i ? source.slice(list[i - 1].end, list[i].start) : "";
    const tight = ["?", ":", ",", ")", "]", "(", "[", ".", "<", ">"].includes(text) || ["(", "[", ".", "@", "<"].includes(previous ?? "");
    if (isComment(text)) {
      // 与上一个 token 同行的注释留在原行尾，包括 `{`、`}` 之后的注释。
      if (i && !gap.includes("\n")) {
        if (line) {
          append(text, false);
        } else if (lines.length) {
          lines[lines.length - 1] += " " + text;
        } else {
          line = text;
        }
        if (text.startsWith("//")) {
          flush();
        }
        continue;
      }
      flush();
      if (blankBetween(gap)) {
        blank = true;
      }
      line = text;
      flush();
      continue;
    }
    const field = depth === 1 && parens === 0 && brackets === 0 && startsField(list, i);
    if (field) {
      flush();
    }
    if (text === "@" && list[i + 1]?.text === "@" && parens === 0 && previous !== "@") {
      flush();
    }
    if (!line && text !== "}" && blankBetween(gap)) {
      blank = true;
    }
    if (text === "json" && list[i + 1]?.text === "<" && inside.has(i + 1)) {
      // 内联 json 对象整体输出，避免被拆成多行
      let k = i + 1;
      while (k + 1 < list.length && inside.has(k + 1)) {
        k++;
      }
      append(source.slice(list[i].start, list[k].end), tight);
      i = k;
      continue;
    }
    if (text === "{") {
      line += " {";
      flush();
      fresh = true;
      depth++;
      continue;
    }
    if (text === "}") {
      flush();
      depth--;
      line = "}";
      flush();
      if (depth === 0) {
        blank = true;
      }
      continue;
    }
    if (text === ";" && parens === 0 && brackets === 0) {
      flush();
      continue;
    }
    if (text === "(") {
      parens++;
    }
    if (text === ")") {
      parens--;
    }
    if (text === "[") {
      brackets++;
    }
    if (text === "]") {
      brackets--;
    }
    append(text, tight);
    if (text === "," || text === ":") {
      line += " ";
    }
  }
  flush();
  return lines.join(eol).trimEnd() + eol;
}
/** 字段上某个属性的参数原文（不含括号），属性不存在或没有参数列表时为 undefined。 */
function attrArgs(field: Field, name: string): string | undefined {
  return field.attrSpans.find((a) => {
    return a.name === name;
  })?.args;
}
/** `@via(x)` 指向的持有方字段名，写法不合法时为 undefined。 */
function viaTarget(field: Field): string | undefined {
  const name = attrArgs(field, "via")?.trim();
  return name && /^[A-Za-z_$][\w$]*$/.test(name) ? name : undefined;
}
/** 关系补全的一处改写：在指定位置插入或替换文本。 */
interface Completion {
  at: number;
  text: string;
  replace?: [number, number];
}
type Field = ModelInfo["fields"][number];

/**
 * 按本 DSL 的约束补全关系声明，只补解析器明确要求的部分。
 *
 * - 关系字段与持有方按基数配对：数组侧是 1:n，单个侧是 1:1；
 * - 数组关系在目标模型没有回指关系时，整段 1:n 补出来：目标模型补持有方字段，声明方补 `@via`；
 *   单个关系字段本身就是解析器意义上的持有方，不整段补出，否则会把外键搬到对面模型；
 * - `@via(x)` 指向的持有方字段缺失时，把持有外键的一侧补出来；
 * - 模型里已声明的列名与解析器的隐式外键同名时，解析器会报
 *   `bind with @relation(field: ...)`，这时给关系字段补上绑定；
 * - 反向侧是单个关系时外键必须唯一，给持有外键的一侧补 `@unique`。
 *
 * 不猜配对：候选持有方不唯一、目标是多对多、字段已有属性或已有外键列时都不配对；
 * 也不会把同类型的普通列当成外键。
 * 改写后必须仍能通过解析器校验，否则放弃本次补全。
 */
export function completeRelations(source: string): string {
  const list = models(source);
  if (!list.length) {
    return source;
  }
  const byName = new Map(
    list.map((m) => {
      return [m.name, m];
    }),
  );
  /** 主键字段；复合主键或无主键的模型无法推断外键类型。 */
  const primary = (model: ModelInfo) => {
    return model.fields.find((f) => {
      return f.attrs.includes("id");
    });
  };
  /** 隐式外键列的名字，与解析器生成外键列的规则一致。 */
  const foreignKeyName = (name: string, pk: Field) => {
    return name + pk.name[0].toUpperCase() + pk.name.slice(1);
  };
  /**
   * 关系字段的外键列：模型里已声明的、名字与解析器隐式命名一致、
   * 类型与目标主键相同的标量列。同类型但名字不同的普通列不算。
   */
  const foreignKeyColumn = (owner: ModelInfo, name: string, pk: Field) => {
    return owner.fields.find((f) => {
      return f.name === foreignKeyName(name, pk) && !byName.has(f.type) && f.typeText === pk.typeText && !f.attrs.includes("id") && !f.attrs.includes("auto");
    });
  };
  const bind: Completion[] = [];
  const unique: Completion[] = [];
  /** 按目标模型聚合的新建字段，以及与它们一同应用的 @via 编辑。 */
  const creates = new Map<ModelInfo, { texts: string[]; via: Completion[] }>();
  /**
   * 这个名字在目标模型里是否已被占用：已有字段，或本轮另一条规则已排期的新建字段。
   * 两条补全规则可能推出同一个持有方字段名，重名时不补。
   */
  const nameTaken = (target: ModelInfo, name: string) => {
    return (
      target.fields.some((f) => {
        return f.name === name;
      }) ||
      (creates.get(target)?.texts ?? []).some((text) => {
        return text.split(/[:?\s]/)[0] === name;
      })
    );
  };
  for (const model of list) {
    for (const field of model.fields) {
      if (field.many || field.attrs.includes("via")) {
        continue;
      }
      const target = byName.get(field.type);
      if (!target) {
        continue;
      }
      const pk = primary(target);
      if (!pk) {
        continue;
      }
      // 只有列名与隐式外键同名时解析器才会要求显式绑定，此时列的
      // 类型、长度和可空性必须与目标主键一致，否则绑定也没有意义。
      const column = foreignKeyColumn(model, field.name, pk);
      if (!column || column.nullable !== field.nullable) {
        continue;
      }
      const relation = field.attrSpans.find((a) => {
        return a.name === "relation";
      });
      if (!relation) {
        bind.push({ at: field.typeEnd, text: ` @relation(field: ${column.name})` });
        continue;
      }
      // 已有 @relation 调用：把 field 插进参数列表
      if (relation.open === undefined || relation.args === undefined) {
        bind.push({
          at: relation.start - 1,
          text: `@relation(field: ${column.name})`,
          replace: [relation.start - 1, relation.end],
        });
        continue;
      }
      if (/(?:^|,)\s*field\s*:/.test(relation.args)) {
        continue;
      }
      bind.push({
        at: relation.open + 1,
        text: relation.args.trim() ? `field: ${column.name}, ` : `field: ${column.name}`,
      });
    }
  }
  /**
   * 持有方的外键是否唯一：关系字段上的 @unique，或显式外键列上的 @unique。
   * 解析器用这个唯一性决定反向关系的基数。
   */
  const ownerUnique = (owner: Field, target: ModelInfo) => {
    if (owner.attrs.includes("unique")) {
      return true;
    }
    const name = /(?:^|,)\s*field\s*:\s*([A-Za-z_$][\w$]*)/.exec(attrArgs(owner, "relation") ?? "")?.[1];
    return !!target.fields
      .find((f) => {
        return f.name === name;
      })
      ?.attrs.includes("unique");
  };
  /** 已经被 @via 反向过的持有方，键是 `声明方模型.持有方字段`。 */
  const inversed = new Set<string>();
  for (const model of list) {
    for (const field of model.fields) {
      const name = viaTarget(field);
      if (name) {
        inversed.add(model.name + "." + name);
      }
    }
  }
  /**
   * 按基数把关系字段与持有方配对：数组侧是 1:n，单个侧是 1:1。
   * 目标模型里没有唯一的持有方候选，或目标模型已经有指向声明方的数组关系
   * （那是多对多）时都不配对，避免猜错方向。
   */
  const pairUnits: Completion[][] = [];
  for (const model of list) {
    for (const field of model.fields) {
      // @via 必须是字段唯一的属性，已有属性的字段不参与配对。
      if (field.attrs.length) {
        continue;
      }
      const target = byName.get(field.type);
      if (!target) {
        continue;
      }
      // 自关联时字段自己也指向声明方，不能算作对面的候选。
      const toModel = target.fields.filter((f) => {
        return f.type === model.name && f !== field;
      });
      // 目标模型里有数组关系指向声明方时是多对多，不做配对。
      if (
        toModel.some((f) => {
          return f.many;
        })
      ) {
        continue;
      }
      const owners = toModel.filter((f) => {
        return !f.many && !f.attrs.includes("via");
      });
      if (owners.length !== 1) {
        continue;
      }
      const owner = owners[0];
      const key = model.name + "." + owner.name;
      // 同一个持有方只能被反向一次，否则解析器报重复反向关系。
      if (inversed.has(key)) {
        continue;
      }
      const pk = primary(target);
      if (!pk) {
        continue;
      }
      if (field.many) {
        // 数组反向是 1:n，外键不能唯一。
        if (field.nullable || ownerUnique(owner, target)) {
          continue;
        }
      } else {
        // 单个反向是 1:1，必须可空且外键唯一。
        if (!field.nullable) {
          continue;
        }
        // 声明方已经声明了这个关系的外键列，说明它按持有方结构写的。
        const implicit = foreignKeyName(field.name, pk);
        if (
          model.fields.some((f) => {
            return f.name === implicit && !byName.has(f.type);
          })
        ) {
          continue;
        }
      }
      inversed.add(key);
      // @via 与 1:1 需要的 @unique 合成一组，避免出现只有反向没有唯一性的中间态。
      const unit: Completion[] = [{ at: field.typeEnd, text: ` @via(${owner.name})` }];
      if (!field.many && !ownerUnique(owner, target)) {
        unit.push({ at: owner.typeEnd, text: " @unique" });
      }
      pairUnits.push(unit);
    }
  }
  // 反向侧是单个关系时外键必须唯一，持有外键的一侧补 @unique
  for (const model of list) {
    for (const field of model.fields) {
      if (field.many) {
        continue;
      }
      const name = viaTarget(field);
      if (!name) {
        continue;
      }
      const owner = byName.get(field.type)?.fields.find((f) => {
        return f.name === name;
      });
      // 反向侧必须是可选的单个关系，否则解析器要求先改可空性，这里不猜。
      if (!owner || owner.many) {
        continue;
      }
      if (!field.nullable) {
        continue;
      }
      // 外键已经唯一时不再重复补 @unique。
      if (ownerUnique(owner, byName.get(field.type)!)) {
        continue;
      }
      unique.push({ at: owner.typeEnd, text: " @unique" });
    }
  }
  // @via 指向的持有方字段缺失时，把持有外键的一侧补出来
  for (const model of list) {
    for (const field of model.fields) {
      const name = viaTarget(field);
      if (!name) {
        continue;
      }
      const target = byName.get(field.type);
      // 目标模型已经有这个字段（含本轮已排期的），或目标模型不存在，都不猜。
      if (!target || nameTaken(target, name)) {
        continue;
      }
      const pk = primary(model);
      if (!pk) {
        continue;
      }
      // 持有方指向声明 @via 的模型，外键列沿用解析器的隐式命名。
      const column = foreignKeyColumn(target, name, pk);
      const attrs: string[] = [];
      // 已声明的外键列需要显式绑定，可空性必须与该列一致。
      if (column) {
        attrs.push(`relation(field: ${column.name})`);
      }
      // 反向侧是单个关系时外键必须唯一。
      if (!field.many) {
        attrs.push("unique");
      }
      const text = `${name}${column?.nullable ? "?" : ""}: ${model.name}` + (attrs.length ? " @" + attrs.join(" @") : "");
      const group = creates.get(target) ?? { texts: [], via: [] };
      group.texts.push(text);
      creates.set(target, group);
    }
  }
  // 数组关系在目标模型没有回指关系时，整段 1:n 补出来：持有方字段加声明方的 @via
  const missing = new Set<string>();
  for (const model of list) {
    for (const field of model.fields) {
      // @via 必须是字段唯一的属性，已有属性的字段不参与。
      if (field.attrs.length) {
        continue;
      }
      // 只补数组侧。单个关系字段在解析器里本身就是持有方，给它补 @via 会把
      // 外键搬到目标模型，静默反转关系方向，那是用户的建模决定，不代做。
      if (!field.many || field.nullable) {
        continue;
      }
      const target = byName.get(field.type);
      if (!target) {
        continue;
      }
      // 目标模型已经声明了指向声明方的关系时交给配对规则，不新建持有方；
      // 自关联时字段自己就满足这个条件，同样不补，必填的自引用外键无法插入首行。
      if (
        target.fields.some((f) => {
          return f.type === model.name;
        })
      ) {
        continue;
      }
      const pk = primary(model);
      if (!pk) {
        continue;
      }
      // 持有方字段名沿用声明方模型名的小驼峰。
      const name = model.name[0].toLowerCase() + model.name.slice(1);
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        continue;
      }
      if (nameTaken(target, name)) {
        continue;
      }
      // 同一对模型只补一次，否则解析器报重复反向关系。
      const key = model.name + "." + target.name;
      if (missing.has(key)) {
        continue;
      }
      missing.add(key);
      const column = foreignKeyColumn(target, name, pk);
      // 已声明的外键列需要显式绑定，可空性必须与该列一致。
      const text = `${name}${column?.nullable ? "?" : ""}: ${model.name}` + (column ? ` @relation(field: ${column.name})` : "");
      const group = creates.get(target) ?? { texts: [], via: [] };
      group.texts.push(text);
      // 声明方的 @via 与新建的持有方字段同组应用，不会只补一半。
      group.via.push({ at: field.typeEnd, text: ` @via(${name})` });
      creates.set(target, group);
    }
  }
  const apply = (edits: Completion[]) => {
    const sorted = [...edits].sort((x, y) => {
      return y.at - x.at;
    });
    let result = source;
    for (const edit of sorted) {
      const [from, to] = edit.replace ?? [edit.at, edit.at];
      result = result.slice(0, from) + edit.text + result.slice(to);
    }
    return result;
  };
  /** 新字段的缩进，跟随目标模型里已有字段的行首缩进。 */
  const indentOf = (model: ModelInfo) => {
    const first = model.fields[0];
    if (!first) {
      return "  ";
    }
    const lineStart = source.lastIndexOf("\n", first.start - 1) + 1;
    const head = source.slice(lineStart, first.start);
    return /^[\t ]*$/.test(head) ? head : "  ";
  };
  /**
   * 把新字段插到目标模型里：模型级属性之前，没有模型级属性时插到结尾花括号前。
   * 插入点前的空行会被跳过，让新字段紧跟最后一个已有字段。
   */
  const insertFields = (model: ModelInfo, texts: string[]): Completion => {
    const at = model.insertAt;
    const indent = indentOf(model);
    const body =
      texts
        .map((t) => {
          return indent + t;
        })
        .join("\n") + "\n";
    const lineStart = source.lastIndexOf("\n", at - 1) + 1;
    const head = source.slice(lineStart, at);
    // 插入点和字段不在同一行，直接在原位换行插入。
    if (!/^[\t ]*$/.test(head)) {
      return { at, text: "\n" + body };
    }
    let start = lineStart;
    for (;;) {
      const prevEnd = start - 1;
      if (prevEnd < 0) {
        break;
      }
      const prevStart = source.lastIndexOf("\n", prevEnd - 1) + 1;
      if (source.slice(prevStart, prevEnd).trim()) {
        break;
      }
      start = prevStart;
    }
    return { at: start, text: body };
  };
  const check = (text: string) => {
    try {
      parseSchema(text);
      return true;
    } catch {
      return false;
    }
  };
  /**
   * 每个补全决策是一组编辑：同目标模型的新建字段与它的 @via 必须同进同退。
   * 逐组贪心，加上这一组后仍能通过解析器才接受，
   * 避免一处冲突连带丢弃整份文件里其他本可成功的补全。
   */
  const units: Completion[][] = [
    ...[...creates.entries()].map(([model, group]) => {
      return [insertFields(model, group.texts), ...group.via];
    }),
    ...pairUnits,
    ...bind.map((edit) => {
      return [edit];
    }),
    ...unique.map((edit) => {
      return [edit];
    }),
  ];
  const combined = units.flat();
  if (combined.length && check(apply(combined))) {
    return apply(combined);
  }
  const accepted: Completion[] = [];
  for (const unit of units) {
    const next = [...accepted, ...unit];
    if (check(apply(next))) {
      accepted.push(...unit);
    }
  }
  return accepted.length ? apply(accepted) : source;
}
export interface ModelInfo {
  name: string;
  /** 模型名的位置，跳转定义时定位到这里。 */
  start: number;
  /** 模型体的结束位置：结尾花括号之前；模型未闭合时是文本末尾。 */
  end: number;
  /** 新字段的插入位置：模型级属性之前，没有模型级属性时是结尾花括号之前。 */
  insertAt: number;
  fields: {
    name: string;
    /** 类型名；字符串字面量联合（枚举）记作 string。 */
    type: string;
    /** 类型片段原文，含长度精度与数组标记。 */
    typeText: string;
    /** 类型片段结束位置，补属性时在此插入。 */
    typeEnd: number;
    start: number;
    many: boolean;
    nullable: boolean;
    hasDefault: boolean;
    attrs: string[];
    attrSpans: AttrSpan[];
  }[];
}
/** 属性名与参数列表的位置，用于补全时改写属性调用。 */
export interface AttrSpan {
  name: string;
  start: number;
  end: number;
  /** 左括号的起始位置。 */
  open?: number;
  /** 右括号的结束位置。 */
  close?: number;
  /** 括号内的参数原文。 */
  args?: string;
}
export function models(source: string): ModelInfo[] {
  const list = tokens(source).filter((t) => {
    return !isComment(t.text);
  });
  const inside = jsonSpans(list);
  const result: ModelInfo[] = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].text !== "model" || !isIdent(list[i + 1]?.text) || list[i + 2]?.text !== "{") {
      continue;
    }
    const model: ModelInfo = {
      name: list[i + 1].text,
      start: list[i + 1].start,
      end: source.length,
      insertAt: source.length,
      fields: [],
    };
    let nesting = 0;
    /** 第一个模型级属性的位置，新字段插在它之前。 */
    let blockAt: number | undefined;
    let j = i + 3;
    for (; j < list.length; j++) {
      const t = list[j];
      if (inside.has(j)) {
        continue;
      }
      if (t.text === "}" && nesting === 0) {
        model.end = t.start;
        model.insertAt = blockAt ?? t.start;
        break;
      }
      if (["(", "["].includes(t.text)) {
        nesting++;
      }
      if ([")", "]"].includes(t.text)) {
        nesting--;
      }
      if (nesting === 0 && blockAt === undefined && t.text === "@" && list[j + 1]?.text === "@") {
        blockAt = t.start;
      }
      if (nesting !== 0 || !startsField(list, j)) {
        continue;
      }
      const nullable = list[j + 1].text === "?";
      const colon = nullable ? j + 2 : j + 1;
      const type = list[colon + 1];
      if (!type) {
        continue;
      }
      const span = typeSpan(list, colon + 1, inside);
      model.fields.push({
        name: t.text,
        type: type.text.startsWith('"') ? "string" : type.text,
        typeText: source.slice(type.start, list[span.last].end),
        typeEnd: list[span.last].end,
        start: t.start,
        many: span.many,
        nullable,
        ...fieldMeta(source, list, span.last + 1, inside),
      });
    }
    result.push(model);
    // 模型体内的 token 不会再开始另一个模型。
    i = j;
  }
  return result;
}
/** `json<...>` 尖括号内部的 token，不参与模型边界和字段识别。 */
function jsonSpans(list: Token[]): Set<number> {
  const skipped = new Set<number>();
  for (let i = 0; i < list.length; i++) {
    if (list[i].text !== "json" || list[i + 1]?.text !== "<") {
      continue;
    }
    // 未闭合时延伸到末尾，与解析器报错前看到的范围一致。
    const end = closing(list, i + 1, "<", ">") ?? list.length - 1;
    for (let j = i + 1; j <= end; j++) {
      skipped.add(j);
    }
    i = end;
  }
  return skipped;
}
/** 光标之前是否有未闭合的 `json<`，即正在写内联 JSON 类型。 */
function openJson(list: Token[]): boolean {
  let depth = 0;
  for (let i = 0; i < list.length; i++) {
    const text = list[i].text;
    if (depth) {
      if (text === "<") {
        depth += 1;
      } else if (text === ">") {
        depth -= 1;
      }
    } else if (text === "json" && list[i + 1]?.text === "<") {
      depth = 1;
      i++;
    }
  }
  return depth > 0;
}
/** 与括号配对的位置，找不到时为 undefined。 */
function closing(list: Token[], from: number, open: string, close: string): number | undefined {
  let depth = 0;
  for (let k = from; k < list.length; k++) {
    if (list[k].text === open) {
      depth++;
    } else if (list[k].text === close && !--depth) {
      return k;
    }
  }
  return undefined;
}
/**
 * 字段类型片段的最后一个 token，顺序与解析器一致：
 * 类型名或字符串联合、json<...>、长度精度、数组标记。
 */
function typeSpan(list: Token[], from: number, inside: Set<number>) {
  let last = from;
  let many = false;
  if (list[from].text.startsWith('"')) {
    while (list[last + 1]?.text === "|" && list[last + 2]?.text.startsWith('"')) {
      last += 2;
    }
  }
  while (inside.has(last + 1)) {
    last++;
  }
  if (list[last + 1]?.text === "(") {
    last = closing(list, last + 1, "(", ")") ?? last;
  }
  if (list[last + 1]?.text === "[" && list[last + 2]?.text === "]") {
    last += 2;
    many = true;
  }
  return { last, many };
}
/** 属性名与参数列表的位置，参数列表缺失时只记录属性名。 */
function attrSpan(source: string, list: Token[], at: number, close?: Token): AttrSpan {
  const name = list[at];
  const open = close ? list[at + 1] : undefined;
  return {
    name: name.text,
    start: name.start,
    end: (close ?? name).end,
    open: open?.start,
    close: close?.end,
    args: open && close ? source.slice(open.end, close.start) : undefined,
  };
}
/** 扫描类型之后的字段尾部，收集默认值和已写下的属性，用于按上下文过滤提示。 */
function fieldMeta(source: string, list: Token[], from: number, inside: Set<number>) {
  let depth = 0;
  let hasDefault = false;
  const attrs: string[] = [];
  const attrSpans: AttrSpan[] = [];
  for (let k = from; k < list.length; k++) {
    const text = list[k].text;
    const next = list[k + 1]?.text;
    if (inside.has(k)) {
      continue;
    }
    if (["(", "[", "{"].includes(text)) {
      depth++;
    } else if ([")", "]", "}"].includes(text)) {
      if (text === "}" && depth === 0) {
        break;
      }
      depth--;
    } else if (depth === 0) {
      const glued = list[k].end === list[k + 1]?.start;
      if (text === "@" && next === "@" && glued) {
        break;
      }
      if (text === "@" && isIdent(next) && glued) {
        const close = list[k + 2]?.text === "(" ? closing(list, k + 2, "(", ")") : undefined;
        const span = attrSpan(source, list, k + 1, close === undefined ? undefined : list[close]);
        attrs.push(span.name);
        attrSpans.push(span);
        k = close ?? k + 1;
        continue;
      }
      if (text === "=") {
        hasDefault = true;
        continue;
      }
      if (startsField(list, k)) {
        break;
      }
    }
  }
  return { hasDefault, attrs, attrSpans };
}
export const help: Record<string, string> = {
  model: "定义数据库模型。",
  json: "类型化 JSON 字段。",
  softDelete: "启用内置软删除；省略参数时默认使用可空的 deletedAt，字段未声明会自动创建。",
  int: "安全整数，返回 number。",
  bigint: "64 位整数，默认返回十进制字符串。",
  number: "浮点数。",
  decimal: "定点小数，读写为字符串。",
  string: "字符串；省略长度时按 191 个字符处理，string(n) 可自定义。",
  text: "不限长度文本；不能作为键或索引。",
  boolean: "布尔值。",
  timestamp: "Unix 毫秒时间戳，使用整数列保存日期时间。",
  datetime: "本地日期时间，返回不带时区的规范化字符串（YYYY-MM-DD HH:mm:ss.SSS）。",
  bytes: "二进制数据，读写为 Uint8Array；不能作为键或索引。",
  morph: "多态持有方：绑定判别列与主键列，省略参数时自动生成 nameType/nameId 两列。",
  id: "主键。",
  auto: "自动生成的整数主键。",
  unique: "唯一约束。",
  updatedAt: "创建和每次更新时自动写入当前时间。",
  map: "数据库中的列名。",
  via: "反向关系：指定目标模型的关系字段，且必须是该字段唯一的属性。",
  relation: "绑定外键字段或配置外键动作，只用于单一关系字段。",
  index: "模型级索引。",
  now: "当前时间默认值。",
  uuid: "UUID 字符串默认值。",
  field: "指定已声明的外键列名。",
  onDelete: "删除被引用记录时的外键动作。",
  onUpdate: "修改被引用记录时的外键动作。",
  Cascade: "一并删除或更新引用它的记录。",
  Restrict: "存在引用时拒绝，默认值。",
  NoAction: "由数据库在语句或事务结束时检查。",
  SetNull: "把外键设为 NULL，只能用于可选关系。",
};
/** 每条提示的示例片段，与 help 同名键一一对应。 */
export const examples: Record<string, string> = {
  model: "model User {\n  id: int @id @auto\n  email: string @unique\n}",
  json: 'type Preferences = {\n  theme: "light" | "dark"\n}\n\nmodel Account {\n  id: int @id @auto\n  preferences?: json<Preferences>\n}',
  softDelete: "id: int @id @auto\n\n  @@softDelete()",
  int: "id: int @id @auto",
  bigint: "id: bigint @id @auto",
  number: "rating: number",
  decimal: "amount: decimal(10, 2)",
  string: "email: string",
  text: "body?: text",
  boolean: "enabled: boolean = true",
  timestamp: "createdAt: timestamp = now()",
  datetime: "createdAt: datetime = now()",
  bytes: "avatar?: bytes",
  morph: 'ownerType: "Post" | "User"\n  ownerId: int\n  owner: morph(ownerType, ownerId)',
  id: "id: int @id @auto",
  auto: "id: int @id @auto",
  unique: "email: string @unique",
  updatedAt: "updatedAt: datetime @updatedAt",
  map: 'createdAt: datetime = now() @map("created_at")',
  via: "posts: Post[] @via(author)",
  relation: "ownerId: int\n  owner: User @relation(field: ownerId, onDelete: Cascade)",
  index: "email: string\n\n  @@index(email)",
  now: "createdAt: datetime = now()",
  uuid: "id: string(36) = uuid() @id",
  true: "enabled: boolean = true",
  false: "published: boolean = false",
  null: "name?: string = null",
  field: "ownerId: int\n  owner: User @relation(field: ownerId)",
  onDelete: "author: User @relation(onDelete: Cascade)",
  onUpdate: "author: User @relation(onUpdate: Restrict)",
  Cascade: "author: User @relation(onDelete: Cascade)",
  Restrict: "author: User @relation(onDelete: Restrict)",
  NoAction: "author: User @relation(onDelete: NoAction)",
  SetNull: "editor?: User @relation(onDelete: SetNull)",
};
/** 模型级属性与字段级同名属性写法不同，单独给出说明和示例。 */
const blockHelp: Record<string, string> = {
  id: "复合主键。",
  unique: "复合唯一约束。",
  index: help.index,
  map: "数据库中的表名。",
  softDelete: help.softDelete,
};
const blockExamples: Record<string, string> = {
  id: "account: Account\n  group: Group\n\n  @@id(account, group)",
  unique: "organization: string(64)\n  email: string\n\n  @@unique(organization, email)",
  index: "email: string\n\n  @@index(email)",
  map: '@@map("accounts")',
  softDelete: examples.softDelete,
};
/** 模型级属性的插入片段，省略项使用文档推荐的写法。 */
const blockInsert: Record<string, string> = {
  map: 'map("$1")',
  softDelete: "softDelete()",
};
/** 外键动作选项的默认值，用于生成插入片段。 */
const actionDefaults: Record<string, string> = { onDelete: "Cascade", onUpdate: "Restrict" };
/** json<...> 内部的基本类型写法，与字段类型示例不同。 */
const jsonExamples: Record<string, string> = {
  string: "tags: json<string[]>",
  number: "score: json<number>",
  boolean: "enabled: json<boolean>",
  null: "value: json<null>",
  Record: "meta: json<Record<string, number>>",
};
/** 只读自有键，避免字段名恰好是 `constructor`、`toString` 时取到原型上的成员。 */
const own = (table: Record<string, string>, key: string) => {
  return Object.hasOwn(table, key) ? table[key] : undefined;
};
export type SuggestionKind = "keyword" | "type" | "model" | "field" | "attribute" | "value" | "snippet";
export interface Suggestion {
  label: string;
  kind: SuggestionKind;
  insert?: string;
  description: string;
  example?: string;
}
/** 按字段形态过滤属性：标量字段不能是关系，数组关系只允许 @via，重复属性和非法组合会被解析器报错。 */
function applicable(label: string, field: Field | undefined, relation: boolean): boolean {
  if (!field) {
    return true;
  }
  if (field.attrs.includes(label)) {
    return false;
  }
  // @via 必须是字段唯一的属性：已有其他属性时不能加 @via，加了 @via 就不能再加别的。
  if (field.attrs.includes("via")) {
    return false;
  }
  if (label === "via" && field.attrs.length) {
    return false;
  }
  if (relation) {
    return field.many ? label === "via" : ["via", "unique", "relation"].includes(label);
  }
  if (["via", "relation"].includes(label)) {
    return false;
  }
  // morph 字段不接受任何属性：判别列与主键列在目标字段上声明。
  if (field.type === "morph") {
    return false;
  }
  if (field.type === "json") {
    return label === "map";
  }
  if (field.type === "bytes") {
    return label === "map";
  }
  // text 不限长度，MySQL 需要前缀索引，因此不能做键或索引。
  if (field.type === "text") {
    return label === "map";
  }
  if (label === "auto") {
    return ["int", "bigint"].includes(field.type) && !field.hasDefault;
  }
  if (label === "updatedAt") {
    return ["datetime", "timestamp"].includes(field.type) && !field.hasDefault;
  }
  if (label === "id") {
    return !field.nullable;
  }
  return true;
}
export function suggestions(source: string, offset: number): Suggestion[] {
  return listed(source, offset).map((s) => {
    return {
      ...s,
      example: s.example ?? own(examples, s.label),
    };
  });
}
/** 字符串 token 是否已闭合；结尾的 `"` 可能是被转义的。 */
const closedString = (text: string) => {
  return /^"(?:\\.|[^"\\])*"$/.test(text);
};
/** 光标是否落在注释或未闭合的字符串里。 */
function inLiteral(before: string, last: Token | undefined): boolean {
  if (!last) {
    return false;
  }
  if (last.text.startsWith("//")) {
    return !before.slice(last.end).includes("\n");
  }
  if (last.text.startsWith("/*")) {
    return last.end === before.length && !/^\/\*[\s\S]*\*\/$/.test(last.text);
  }
  if (last.text.startsWith('"')) {
    return last.end === before.length && !closedString(last.text);
  }
  return false;
}
/** JSON 类型位置可用的类型：内置类型加上文件里声明的 `type X = ...`。 */
function jsonTypes(list: Token[]): Suggestion[] {
  return [
    ...["string", "number", "boolean", "null", "Record"].map((label) => {
      return {
        label,
        kind: "type" as const,
        description: "JSON 类型",
        example: jsonExamples[label],
      };
    }),
    ...list.flatMap((token, i) => {
      return token.text === "type" && isIdent(list[i + 1]?.text) && list[i + 2]?.text === "="
        ? [
            {
              label: list[i + 1].text,
              kind: "type" as const,
              description: "JSON 类型",
              example: "field: json<" + list[i + 1].text + ">",
            },
          ]
        : [];
    }),
  ];
}
/** 光标所在的模型，以及光标之前最后一个字段（属性、默认值都挂在它上面）。 */
function context(source: string, offset: number) {
  const all = models(source);
  const current = all.find((m) => {
    return m.start < offset && offset <= m.end;
  });
  const field = current?.fields
    .filter((f) => {
      return f.start < offset;
    })
    .at(-1);
  return { all, current, field };
}
function listed(source: string, offset: number): Suggestion[] {
  const before = source.slice(0, offset);
  const previous = tokens(before);
  const tail = before.slice(-300);
  if (inLiteral(before, previous.at(-1))) {
    return [];
  }
  // 内联 json<...> 里写的是 JSON 类型，不是列类型。
  if (openJson(previous)) {
    return /[<:|,]\s*[\w$]*$/.test(tail) ? jsonTypes(tokens(source)) : [];
  }
  const { all, current, field } = context(source, offset);
  const relationArgs = /@relation\(([^()]*)$/.exec(tail)?.[1];
  if (relationArgs !== undefined) {
    return relationOptions(all, current, field, relationArgs);
  }
  if (/@via\(\s*[\w$]*$/.test(tail)) {
    const target = all.find((m) => {
      return m.name === field?.type;
    });
    // 只有指向当前模型的持有方能被反向；已带 @via 的字段本身就是反向侧。
    return (target?.fields ?? [])
      .filter((f) => {
        return f.type === current?.name && !f.attrs.includes("via") && f !== field;
      })
      .map((f) => {
        return {
          label: f.name,
          kind: "field",
          description: "目标关系字段",
          example: `${field!.name}${field!.nullable ? "?" : ""}: ${field!.typeText} @via(${f.name})`,
        };
      });
  }
  if (/@@softDelete\(\s*[\w$]*$/.test(tail)) {
    return (current?.fields ?? [])
      .filter((f) => {
        return (
          ["datetime", "timestamp"].includes(f.type) &&
          f.nullable &&
          !f.attrs.some((a) => {
            return ["id", "unique"].includes(a);
          })
        );
      })
      .map((f) => {
        return {
          label: f.name,
          kind: "field",
          description: "软删除时间字段",
          example: "@@softDelete(" + f.name + ")",
        };
      });
  }
  const keys = /@@(index|unique|id)\(([^[\])]*)$/.exec(tail);
  if (keys) {
    const [, attr, args] = keys;
    const written = new Set(
      args.split(",").map((k) => {
        return k.trim();
      }),
    );
    // 只有列和单个持有方关系能作为索引键；@@id 的键还必须非空且不是 json。
    return (current?.fields ?? [])
      .filter((f) => {
        return !written.has(f.name) && !f.many && !["json", "bytes", "text", "morph"].includes(f.type) && !f.attrs.includes("via") && (attr !== "id" || (!f.nullable && f.type !== "json"));
      })
      .map((f) => {
        return {
          label: f.name,
          kind: "field",
          description: f.typeText || "字段",
          example: `@@${attr}(${[...written].filter(Boolean).concat(f.name).join(", ")})`,
        };
      });
  }
  if (/@@\w*$/.test(tail)) {
    return ["id", "unique", "index", "map", "softDelete"].map((label) => {
      return {
        label,
        kind: "attribute",
        insert: blockInsert[label] ?? label + "($1)",
        description: blockHelp[label],
        example: blockExamples[label],
      };
    });
  }
  if (/@\w*$/.test(tail)) {
    const relation =
      !!field &&
      all.some((m) => {
        return m.name === field.type;
      });
    return ["id", "auto", "unique", "updatedAt", "map", "via", "relation"]
      .filter((label) => {
        return applicable(label, field, relation);
      })
      .map((label) => {
        return {
          label,
          kind: "attribute",
          description: help[label],
          insert: fieldInsert[label] ?? label,
        };
      });
  }
  if (/=\s*\w*$/.test(tail)) {
    if (!current) {
      return jsonTypes(tokens(source));
    }
    return ["true", "false", "null", "now", "uuid"].map((label) => {
      return {
        label,
        kind: "value",
        insert: ["now", "uuid"].includes(label) ? label + "()" : label,
        description: own(help, label) ?? "默认值",
      };
    });
  }
  if (/:\s*\w*$/.test(tail)) {
    return current
      ? [
          ...["int", "bigint", "number", "decimal", "string", "text", "boolean", "datetime", "timestamp", "json", "bytes", "morph"].map((label) => {
            return {
              label,
              kind: "type" as const,
              description: help[label],
              insert: typeInsert[label],
            };
          }),
          ...all.map((m) => {
            return {
              label: m.name,
              kind: "model" as const,
              description: "关系模型",
              example: "owner: " + m.name + "\nownerId: int",
            };
          }),
        ]
      : jsonTypes(tokens(source));
  }
  return current
    ? [
        {
          label: "field",
          kind: "snippet",
          insert: "${1:name}: ${2:string}",
          description: "字段定义",
          example: "name?: string",
        },
      ]
    : [
        {
          label: "model",
          kind: "keyword",
          insert: "model ${1:Name} {\n  id: int @id @auto\n  $0\n}",
          description: help.model,
        },
      ];
}
/** 字段级属性的插入片段。 */
const fieldInsert: Record<string, string> = {
  map: 'map("$1")',
  via: "via($1)",
  relation: "relation(field: ${1:column})",
};
/** 列类型的插入片段，带参数的类型给出占位。 */
const typeInsert: Record<string, string> = {
  json: "json<$1>",
  decimal: "decimal(${1:10}, ${2:2})",
};
/** `@relation(...)` 参数列表内的提示：选项名、外键列或外键动作。 */
function relationOptions(all: ModelInfo[], current: ModelInfo | undefined, field: Field | undefined, args: string): Suggestion[] {
  const option = /(?:^|,)\s*(field|onDelete|onUpdate)\s*:\s*[\w$]*$/.exec(args)?.[1];
  if (option === "field") {
    const targets = new Set(
      all.map((m) => {
        return m.name;
      }),
    );
    // 外键列可以声明在关系字段之后；主键、自增列和关系字段都不能当外键。
    return (current?.fields ?? [])
      .filter((f) => {
        return (
          f !== field &&
          !targets.has(f.type) &&
          !f.many &&
          !f.attrs.some((a) => {
            return ["id", "auto"].includes(a);
          })
        );
      })
      .map((f) => {
        return {
          label: f.name,
          kind: "field",
          description: "外键字段：" + f.typeText,
          example: `${field?.name ?? "owner"}: ${field?.type ?? "User"} @relation(field: ${f.name})`,
        };
      });
  }
  if (option) {
    const target = field?.type ?? "User";
    return ["Cascade", "Restrict", "NoAction", "SetNull"]
      .filter((label) => {
        return label !== "SetNull" || field?.nullable;
      })
      .map((label) => {
        return {
          label,
          kind: "value",
          description: help[label],
          example: `author${label === "SetNull" ? "?" : ""}: ${target} @relation(${option}: ${label})`,
        };
      });
  }
  // 位于选项名的位置时，只提示还没写过的选项。
  if (!/(?:^|,)\s*[\w$]*$/.test(args)) {
    return [];
  }
  const used = new Set(
    [...args.matchAll(/([\w$]+)\s*:/g)].map((m) => {
      return m[1];
    }),
  );
  return ["field", "onDelete", "onUpdate"]
    .filter((label) => {
      return !used.has(label);
    })
    .map((label) => {
      return {
        label,
        kind: "keyword",
        insert: label === "field" ? "field: $1" : label + ": ${1:" + actionDefaults[label] + "}",
        description: help[label],
      };
    });
}
/** 光标处的标识符，注释和字符串里的单词不算。 */
export function wordAt(source: string, offset: number): Token | undefined {
  return tokens(source).find((t) => {
    return t.start <= offset && offset <= t.end && isIdent(t.text);
  });
}
/** 悬停说明：模型显示字段列表，关键字显示说明与示例。 */
export function hoverText(source: string, offset: number): string | undefined {
  const word = wordAt(source, offset)?.text;
  if (!word) {
    return;
  }
  const model = models(source).find((m) => {
    return m.name === word;
  });
  if (model) {
    return (
      "模型 **" +
      model.name +
      "**\n\n```tsorm\n" +
      model.fields
        .map((f) => {
          return f.name + (f.nullable ? "?" : "") + ": " + f.typeText;
        })
        .join("\n") +
      "\n```"
    );
  }
  const text = own(help, word);
  if (!text) {
    return;
  }
  const example = own(examples, word);
  return example ? markdown(word + ": " + text, example) : word + ": " + text;
}
/** 说明文字加示例代码块的 Markdown。 */
export const markdown = (title: string, example: string) => {
  return title + "\n\n**示例**\n\n```tsorm\n" + example + "\n```";
};
/**
 * 跳转定义的目标位置：模型名跳到模型声明；
 * `@via(x)` 跳到目标模型的持有方字段；`@relation(field: x)` 与模型级属性里的字段名跳到本模型的字段。
 */
export function definition(source: string, offset: number): number | undefined {
  const word = wordAt(source, offset);
  if (!word) {
    return;
  }
  const all = models(source);
  const model = all.find((m) => {
    return m.name === word.text;
  });
  if (model) {
    return model.start;
  }
  const current = all.find((m) => {
    return m.start < word.start && word.start <= m.end;
  });
  if (!current) {
    return;
  }
  // 找到包住这个单词的属性调用：向前跳过配对的括号，直到未闭合的 `(`。
  const list = tokens(source.slice(current.start, word.start));
  let depth = 0;
  let k = list.length - 1;
  for (; k >= 0; k--) {
    if (list[k].text === ")") {
      depth++;
    } else if (list[k].text === "(" && !depth--) {
      break;
    }
  }
  const attr = list[k - 1]?.text;
  if (k < 1 || list[k - 2]?.text !== "@") {
    return;
  }
  if (attr === "via") {
    const field = current.fields
      .filter((f) => {
        return f.start < word.start;
      })
      .at(-1);
    const target = all.find((m) => {
      return m.name === field?.type;
    });
    return target?.fields.find((f) => {
      return f.name === word.text;
    })?.start;
  }
  if (!["relation", "id", "unique", "index", "softDelete"].includes(attr)) {
    return;
  }
  // @relation 只有 field 的值是字段名，onDelete 等选项的值不是。
  if (attr === "relation" && !/(?:^|[(,])\s*field\s*:\s*$/.test(source.slice(current.start, word.start))) {
    return;
  }
  return current.fields.find((f) => {
    return f.name === word.text;
  })?.start;
}
