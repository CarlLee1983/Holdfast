import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

const dialect = new SQLiteSyncDialect();

/**
 * 把 drizzle 的 SQL 片段組成 D1 語句，才能與其他語句放進同一個 `d1.batch`。
 * 不用 drizzle 的 `db.run`：它在 D1 上進不了 batch（SQLiteRaw 沒有 `stmt`，
 * D1 session 也沒有 run 結果的 batch 映射；已讀 drizzle-orm 0.45 原始碼確認）。
 */
export function toD1Statement(d1: D1Database, query: SQL): D1PreparedStatement {
  const { sql: text, params } = dialect.sqlToQuery(query);
  return d1.prepare(text).bind(...params);
}
