import { createHash } from "node:crypto";

// ─── SQL identifiers ───────────────────────────────────────────────────────
export const quoteIdentifier = (name: string) => {
  return '"' + name.replaceAll('"', '""') + '"';
};
/**
 * 带括号条件的合取；没有条件时返回 `truth`。
 * Conjunction of parenthesized conditions; `truth` when there are none.
 */
export const allOf = (pieces: string[], truth: string) => {
  return pieces.length
    ? pieces
        .map((piece) => {
          return "(" + piece + ")";
        })
        .join(" AND ")
    : truth;
};
// ─── DDL helpers ───────────────────────────────────────────────────────────
/**
 * 为索引或约束生成稳定名称，且长度适用于所有数据库。
 * Stable generated name for an index or constraint, short enough for every database.
 */
export const hashedName = (...parts: string[]) => {
  return "orm_" + createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
};
/**
 * 迁移历史表所需的列类型；只有这些类型因数据库提供方而异。
 * Column types the migration history table needs; only these differ between providers.
 */
export interface HistoryTypes {
  /**
   * 主键列类型，例如 `VARCHAR(36)` 或 `TEXT`。
   * Primary key column type, e.g. `VARCHAR(36)` or `TEXT`.
   */
  id: string;
  /**
   * started/finished/rolled-back 使用的时间戳列类型。
   * Timestamp column type for started/finished/rolled-back.
   */
  time: string;
  /**
   * `started_at` 的默认表达式。
   * Default expression for `started_at`.
   */
  now: string;
  /**
   * 追加在右括号后的表选项。
   * Table options appended after the closing parenthesis.
   */
  suffix?: string;
}
/**
 * 所有数据库提供方共用的迁移历史表。
 * Migration history table shared by every provider.
 */
export function historyTableDDL(table: string, quote: (name: string) => string, types: HistoryTypes): string {
  return `CREATE TABLE IF NOT EXISTS ${quote(table)} (
    ${quote("id")}                    ${types.id} PRIMARY KEY NOT NULL,
    ${quote("checksum")}              VARCHAR(64) NOT NULL,
    ${quote("finished_at")}           ${types.time},
    ${quote("migration_name")}        VARCHAR(255) NOT NULL,
    ${quote("logs")}                  TEXT,
    ${quote("rolled_back_at")}        ${types.time},
    ${quote("started_at")}            ${types.time} NOT NULL DEFAULT ${types.now}
)${types.suffix ?? ""}`;
}

/**
 * 用于默认值、枚举成员或注释的 SQL 字面量；布尔值转换为 1/0。
 * SQL literal for a default, enum member or comment; booleans become 1/0.
 */
export const literal = (v: any) => {
  if (v === null) {
    return "NULL";
  }
  if (typeof v === "string") {
    return "'" + v.replaceAll("'", "''") + "'";
  }
  if (typeof v === "boolean") {
    return Number(v);
  }
  return v;
};
