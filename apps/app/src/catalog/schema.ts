import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 所有時間欄位一律存 UTC epoch 毫秒（integer），顯示時區由呼叫端決定。

export const resources = sqliteTable("resources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** 保留期限（Hold TTL），單位秒，預設 10 分鐘。 */
  holdTtlSeconds: integer("hold_ttl_seconds").notNull().default(600),
  /** 單筆名額上限（Seats Per Hold）。 */
  seatsPerHold: integer("seats_per_hold").notNull(),
  /** 取消截止時間（Cancellation Cutoff）：時段開始前幾秒起會員不可自行取消。 */
  cancellationCutoffSeconds: integer("cancellation_cutoff_seconds").notNull(),
  /** 給顧客看的純文字說明，選填，最多 200 字（在 App 端驗證）。 */
  description: text("description"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const slots = sqliteTable(
  "slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    resourceId: integer("resource_id")
      .notNull()
      .references(() => resources.id),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    /** 容量（Capacity）：最多可占用的名額（Seat）總數。 */
    capacity: integer("capacity").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("slots_resource_id_starts_at_idx").on(t.resourceId, t.startsAt)],
);
