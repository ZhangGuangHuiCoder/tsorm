import type { MigrationProvider } from "./provider.js";
import type { Connection } from "./provider.js";

/** Physical structure of one database, as Migrate compares it. */
export interface DbColumn {
  name: string;
  /** Normalized type text as the database reports it. */
  type: string;
  nullable: boolean;
  default: string | null;
  auto: boolean;
  /** Full column definition used when rendering DDL. */
  definition: string;
  /** Column comment, when the database stores one. */
  comment?: string;
}
export interface DbConstraint {
  name: string;
  columns: string[];
  /** Canonical definition used both for comparison and rendering. */
  definition: string;
}
export interface DbIndex extends DbConstraint {
  unique: boolean;
}
export interface DbForeignKey extends DbConstraint {
  table: string;
  references: string[];
}
export interface DbCheck {
  name: string;
  column?: string;
  expression: string;
}
export interface DbTable {
  name: string;
  columns: DbColumn[];
  primaryKey?: DbConstraint;
  /** Unique constraints that are not standalone indexes. */
  uniques: DbConstraint[];
  indexes: DbIndex[];
  checks: DbCheck[];
  foreignKeys: DbForeignKey[];
  /** Full CREATE TABLE text as the provider captures it. */
  definition: string;
  /** Table comment, when the database stores one. */
  comment?: string;
}
export interface DbModel {
  provider: MigrationProvider;
  tables: Record<string, DbTable>;
}

import { HISTORY_TABLE } from "../schema/index.js";

export { HISTORY_TABLE };

/** The history table this connection's migrations are recorded in. */
export const historyTable = (conn: Connection): string => {
  return conn.datasource.historyTable ?? HISTORY_TABLE;
};

export function introspect(conn: Connection): Promise<DbModel> {
  return conn.provider.introspect(conn);
}

/** Splits SQL at top-level separators, honouring quotes and parentheses. */
export function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          i++;
        } else {
          quote = null;
        }
      } else if (quote === "]" && ch === "]") {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "[") {
      quote = "]";
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/** Returns the balanced parenthesized text starting at `open`, including the parentheses. */
export function balanced(text: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = text[i + 1] === quote ? (i++, quote) : null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")" && --depth === 0) {
      return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

export const unquote = (name: string) => {
  const first = name[0];
  if (first === '"' || first === "`") {
    return name.slice(1, -1).replaceAll(first + first, first);
  }
  if (first === "[") {
    return name.slice(1, -1);
  }
  return name;
};
export const leadingIdentifier = (text: string) => {
  return /^("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[^\s(]+)/.exec(text)![1];
};
/** Normalize SQL whitespace without changing quoted literals or identifiers. */
export function squash(text: string): string {
  let result = "";
  let quote: string | undefined;
  let space = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      result += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) {
          result += text[++i];
        } else {
          quote = undefined;
        }
      }
    } else if (/\s/.test(ch)) {
      space = true;
    } else {
      if (space && result) {
        result += " ";
      }
      space = false;
      result += ch;
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
      } else if (ch === "[") {
        quote = "]";
      }
    }
  }
  return result;
}

/** CHECK expressions inside one column definition or table constraint, at depth 0. */
export function checksIn(item: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < item.length; i++) {
    const ch = item[i];
    if (quote) {
      if (ch === quote) {
        quote = item[i + 1] === quote ? (i++, quote) : null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (depth === 0 && /^check\s*\(/i.test(item.slice(i)) && !/\w/.test(item[i - 1] ?? "")) {
      const open = item.indexOf("(", i);
      const expression = balanced(item, open);
      found.push(squash(expression));
      i = open + expression.length - 1;
    }
  }
  return found;
}

/** True when the database holds any table besides the migration history and the ignored ones. */
export async function hasTables(conn: Connection): Promise<boolean> {
  return Object.keys((await introspect(conn)).tables).length > 0;
}
