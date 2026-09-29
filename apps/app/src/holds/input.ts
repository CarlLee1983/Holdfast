import { z } from "zod";
import { MAX_SEATS_PER_HOLD, wholeNumber } from "../shared/input";

const MAX_IDEMPOTENCY_KEY_LENGTH = 100;
const MAX_MEMBER_ID_LENGTH = 255;

export const createHoldInput = z.object({
  slotId: wholeNumber("時段").positive("時段編號無效"),
  // 實際上限由資源的 seats_per_hold 在寫入時檢查
  seats: wholeNumber("名額")
    .min(1, "名額至少為 1")
    .max(MAX_SEATS_PER_HOLD, `名額不可超過 ${MAX_SEATS_PER_HOLD}`),
  idempotencyKey: z
    .string({ error: "冪等鍵必須是文字" })
    .trim()
    .min(1, "冪等鍵不可為空")
    .max(MAX_IDEMPOTENCY_KEY_LENGTH, `冪等鍵不可超過 ${MAX_IDEMPOTENCY_KEY_LENGTH} 個字`),
});

export const confirmHoldInput = z.object({
  holdId: wholeNumber("保留").positive("保留編號無效"),
});

/** 會員編號由 Web 從 session 解析後帶入（App 信任它），這裡只擋空值與離譜的長度。 */
export const memberIdInput = z
  .string({ error: "會員編號必須是文字" })
  .min(1, "會員編號不可為空")
  .max(MAX_MEMBER_ID_LENGTH, `會員編號不可超過 ${MAX_MEMBER_ID_LENGTH} 個字`);

export type CreateHoldInput = z.output<typeof createHoldInput>;
