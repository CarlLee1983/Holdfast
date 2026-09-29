import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * 管理操作稽核紀錄（ADR 0007：管理者身分不進 D1，只在這裡留下 Access JWT 的 email）。
 * append-only：應用程式只 INSERT，沒有 UPDATE / DELETE 的程式路徑。
 */
export const adminAudit = sqliteTable("admin_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email").notNull(),
  /** 例如 `resource.create`、`slot.create`。 */
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  /** 操作發生時間，UTC epoch 毫秒（來自 Clock）。 */
  at: integer("at").notNull(),
  /** 操作內容快照，JSON 字串。 */
  detail: text("detail").notNull(),
});
