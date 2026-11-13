import * as vscode from "vscode";
import { schemaErrors, SchemaError } from "../../src/schema/index.js";
import { completeRelations, definition, formatSchema, hoverText, markdown, models, renameError, resolveSymbol, suggestions, symbolReferences, typeAliases, wordAt, type SuggestionKind } from "./language.js";
const language = "tsorm";
const kinds: Record<SuggestionKind, vscode.CompletionItemKind> = {
  keyword: vscode.CompletionItemKind.Keyword,
  type: vscode.CompletionItemKind.TypeParameter,
  model: vscode.CompletionItemKind.Class,
  field: vscode.CompletionItemKind.Field,
  attribute: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.Value,
  snippet: vscode.CompletionItemKind.Snippet,
};
/** 单个解析错误的诊断：定位到出错的单词，没有单词时标出一个字符。 */
function makeDiagnostic(range: vscode.Range, message: string): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = "TSORM";
  return diagnostic;
}
function diagnose(document: vscode.TextDocument, error: SchemaError): vscode.Diagnostic {
  const line = Math.max(0, Math.min(document.lineCount - 1, error.line - 1));
  const text = document.lineAt(line).text;
  const column = Math.max(0, Math.min(text.length, error.column - 1));
  const start = new vscode.Position(line, column);
  const range = document.getWordRangeAtPosition(start) ?? new vscode.Range(start, start.translate(0, column < text.length ? 1 : 0));
  return makeDiagnostic(range, error.message.replace(/^\d+:\d+\s*/, ""));
}
/** 大纲：模型及其字段、JSON 类型别名，按出现位置排序。 */
function documentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const text = document.getText();
  const result: vscode.DocumentSymbol[] = [];
  for (const alias of typeAliases(text)) {
    const range = new vscode.Range(document.positionAt(alias.declStart), document.positionAt(alias.end));
    const name = new vscode.Range(document.positionAt(alias.start), document.positionAt(alias.start + alias.name.length));
    result.push(new vscode.DocumentSymbol(alias.name, "JSON 类型", vscode.SymbolKind.Struct, range, name));
  }
  for (const model of models(text)) {
    // 范围含结尾花括号；未闭合的模型取到文本末尾。
    const end = model.end < text.length ? model.end + 1 : model.end;
    const range = new vscode.Range(document.positionAt(model.start), document.positionAt(end));
    const name = new vscode.Range(document.positionAt(model.start), document.positionAt(model.start + model.name.length));
    const children = model.fields.map((f) => {
      const fieldRange = new vscode.Range(document.positionAt(f.start), document.positionAt(f.end));
      const fieldName = new vscode.Range(document.positionAt(f.start), document.positionAt(f.start + f.name.length));
      return new vscode.DocumentSymbol(f.name, f.typeText, vscode.SymbolKind.Field, fieldRange, fieldName);
    });
    const symbol = new vscode.DocumentSymbol(model.name, "模型", vscode.SymbolKind.Class, range, name);
    symbol.children = children;
    result.push(symbol);
  }
  return result.sort((a, b) => {
    return a.range.start.compareTo(b.range.start);
  });
}
export function activate(context: vscode.ExtensionContext) {
  const selector: vscode.DocumentSelector = { language };
  const diagnostics = vscode.languages.createDiagnosticCollection(language);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancel = (document: vscode.TextDocument) => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const validate = (document: vscode.TextDocument) => {
    if (document.languageId !== language) {
      return;
    }
    try {
      const errors = schemaErrors(document.getText());
      if (errors.length) {
        diagnostics.set(
          document.uri,
          errors.map((e) => diagnose(document, e)),
        );
      } else {
        diagnostics.delete(document.uri);
      }
    } catch (error) {
      // 解析器内部错误也要替换旧诊断，否则上一次的错误会一直留着。
      const detail = error instanceof Error ? error.message : String(error);
      diagnostics.set(document.uri, [makeDiagnostic(new vscode.Range(0, 0, 0, 0), "解析器内部错误：" + detail)]);
    }
  };
  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(validate),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId !== language) {
        return;
      }
      cancel(document);
      timers.set(
        document.uri.toString(),
        setTimeout(() => {
          timers.delete(document.uri.toString());
          validate(document);
        }, 200),
      );
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancel(document);
      diagnostics.delete(document.uri);
    }),
    {
      dispose() {
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
        timers.clear();
      },
    },
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(document, options) {
        const text = document.getText();
        try {
          const complete = vscode.workspace.getConfiguration("tsorm").get<boolean>("format.completeRelations", true);
          const formatted = formatSchema(complete ? completeRelations(text) : text, options.insertSpaces ? " ".repeat(options.tabSize) : "\t", document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
          // 内容没变时不返回编辑，避免把未修改的文件标成已修改。
          if (formatted === text) {
            return [];
          }
          return [vscode.TextEdit.replace(new vscode.Range(document.positionAt(0), document.positionAt(text.length)), formatted)];
        } catch {
          // 有语法错误的文件不格式化，错误已经由诊断报告。
          return [];
        }
      },
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(document, position) {
          const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/) ?? new vscode.Range(position, position);
          return suggestions(document.getText(), document.offsetAt(position)).map((s) => {
            const item = new vscode.CompletionItem(s.label, kinds[s.kind]);
            item.detail = s.description;
            if (s.example) {
              item.documentation = new vscode.MarkdownString(markdown(s.description, s.example));
            }
            item.insertText = s.insert ? new vscode.SnippetString(s.insert) : s.label;
            item.range = range;
            return item;
          });
        },
      },
      "@",
      ":",
      "=",
      "(",
      "<",
      ",",
    ),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const content = hoverText(text, offset);
        const word = wordAt(text, offset);
        if (!content || !word) {
          return;
        }
        return new vscode.Hover(new vscode.MarkdownString(content), new vscode.Range(document.positionAt(word.start), document.positionAt(word.end)));
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition(document, position) {
        const target = definition(document.getText(), document.offsetAt(position));
        return target === undefined ? undefined : new vscode.Location(document.uri, document.positionAt(target));
      },
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        return documentSymbols(document);
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences(document, position) {
        const symbol = resolveSymbol(document.getText(), document.offsetAt(position));
        if (!symbol) {
          return [];
        }
        // 每个 .orm 文件是独立的 schema（CLI 一次只读一个 --schema），所以只在当前文件内查找。
        return symbolReferences(document.getText(), symbol).map((token) => {
          return new vscode.Location(document.uri, new vscode.Range(document.positionAt(token.start), document.positionAt(token.end)));
        });
      },
    }),
    vscode.languages.registerRenameProvider(selector, {
      prepareRename(document, position) {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const word = wordAt(text, offset);
        if (!word || !resolveSymbol(text, offset)) {
          throw new Error("该位置不能重命名");
        }
        return new vscode.Range(document.positionAt(word.start), document.positionAt(word.end));
      },
      provideRenameEdits(document, position, newName) {
        const symbol = resolveSymbol(document.getText(), document.offsetAt(position));
        if (!symbol) {
          throw new Error("该位置不能重命名");
        }
        const problem = renameError(symbol, newName);
        if (problem) {
          throw new Error(problem);
        }
        const edit = new vscode.WorkspaceEdit();
        for (const token of symbolReferences(document.getText(), symbol)) {
          edit.replace(document.uri, new vscode.Range(document.positionAt(token.start), document.positionAt(token.end)), newName);
        }
        return edit;
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        provideCodeActions(document, _range, context) {
          const ours = context.diagnostics.filter((d) => {
            return d.source === "TSORM";
          });
          if (!ours.length) {
            return [];
          }
          const text = document.getText();
          const completed = completeRelations(text);
          // completeRelations 内部已用解析器校验，有改动就必然合法。
          if (completed === text) {
            return [];
          }
          const action = new vscode.CodeAction("补全关系声明", vscode.CodeActionKind.QuickFix);
          action.diagnostics = ours;
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(text.length)), completed);
          action.isPreferred = true;
          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
  vscode.workspace.textDocuments.forEach(validate);
}
export function deactivate() {}
