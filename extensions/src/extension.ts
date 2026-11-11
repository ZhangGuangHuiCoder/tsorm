import * as vscode from "vscode";
import { parseSchema, SchemaError } from "../../src/schema/index.js";
import { completeRelations, definition, formatSchema, hoverText, markdown, suggestions, wordAt, type SuggestionKind } from "./language.js";
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
/** 解析失败时的诊断：定位到出错的单词，没有单词时标出一个字符。 */
function diagnose(document: vscode.TextDocument, error: unknown): vscode.Diagnostic {
  const known = error instanceof SchemaError;
  const line = known ? Math.max(0, Math.min(document.lineCount - 1, error.line - 1)) : 0;
  const text = document.lineAt(line).text;
  const column = known ? Math.max(0, Math.min(text.length, error.column - 1)) : 0;
  const start = new vscode.Position(line, column);
  const range = document.getWordRangeAtPosition(start) ?? new vscode.Range(start, start.translate(0, column < text.length ? 1 : 0));
  let message: string;
  if (known) {
    message = error.message.replace(/^\d+:\d+\s*/, "");
  } else {
    const detail = error instanceof Error ? error.message : String(error);
    message = "解析器内部错误：" + detail;
  }
  const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
  diagnostic.source = "TSORM";
  return diagnostic;
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
      parseSchema(document.getText());
      diagnostics.delete(document.uri);
    } catch (error) {
      // 非 SchemaError 也要替换旧诊断，否则上一次的错误会一直留着。
      diagnostics.set(document.uri, [diagnose(document, error)]);
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
          const formatted = formatSchema(completeRelations(text), options.insertSpaces ? " ".repeat(options.tabSize) : "\t", document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
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
  );
  vscode.workspace.textDocuments.forEach(validate);
}
export function deactivate() {}
