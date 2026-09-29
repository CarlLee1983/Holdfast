import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { slots } from "../catalog/schema";

/**
 * 保留（Hold）：會員在期限內暫時占住的名額。時間欄位一律是 UTC epoch 毫秒。
 * 過期只由 `expires_at > now` 判斷，不靠改 `status`（ADR 0003）；之後的釋放只負責整理。
 */
/** 保留仍占著名額時的狀態；定義在這裡（occupancy 也 import 本檔），由 occupancy 對外再匯出。 */
export const HELD = "held";
export const RELEASED = "released";
/** 已確認的訂位（Booking）：與保留同一張表、同一個 id，只是狀態不同；不再看 `expires_at`。 */
export const CONFIRMED = "confirmed";

export const holds = sqliteTable(
  "holds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => slots.id),
    // 刻意不設外鍵指向 user：帳號刪除（#13）要移除 Better Auth 的 user，但保留與訂位紀錄必須留下
    memberId: text("member_id").notNull(),
    seats: integer("seats").notNull(),
    /** `held`、`confirmed`（訂位）或 `released`（過期清理的標記）。 */
    status: text("status").notNull().default(HELD),
    expiresAt: integer("expires_at").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** 來自 Clock，不用 SQL 預設值，測試才能控制時間。 */
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // 加總已占用名額的子查詢用（ADR 0004）
    index("holds_slot_id_status_expires_at_idx").on(t.slotId, t.status, t.expiresAt),
    // 定時清理依狀態與到期時間尋找過期保留
    index("holds_status_expires_at_idx").on(t.status, t.expiresAt),
    uniqueIndex("holds_member_id_idempotency_key_idx").on(t.memberId, t.idempotencyKey),
    // 會員頁列出自己的有效保留
    index("holds_member_id_expires_at_idx").on(t.memberId, t.expiresAt),
  ],
);
