import { z } from "zod";
import { MAX_SEATS_PER_HOLD, wholeNumber } from "../shared/input";

const DEFAULT_HOLD_TTL_SECONDS = 600;

// 上限：擋掉明顯的手誤與亂填（例如 12 位數的時間、超長名稱），不是業務規則
const MAX_NAME_LENGTH = 200;
const MAX_HOLD_TTL_SECONDS = 86_400;
const MAX_CANCELLATION_CUTOFF_SECONDS = 30 * 86_400;
const MAX_CAPACITY = 100_000;
/** 時段時間的合理範圍（UTC epoch 毫秒，含邊界）：2020-01-01 至 2100-01-01。 */
const MIN_SLOT_TIME = Date.UTC(2020, 0, 1);
const MAX_SLOT_TIME = Date.UTC(2100, 0, 1);

const resourceId = wholeNumber("資源").positive("資源編號無效");

const slotTime = (label: string) =>
  wholeNumber(label)
    .min(MIN_SLOT_TIME, `${label}不可早於 2020-01-01`)
    .max(MAX_SLOT_TIME, `${label}不可晚於 2100-01-01`);

const name = z
  .string({ error: "名稱必須是文字" })
  .trim()
  .min(1, "名稱不可為空")
  .max(MAX_NAME_LENGTH, `名稱不可超過 ${MAX_NAME_LENGTH} 個字`);

const holdTtlSeconds = wholeNumber("保留期限")
  .positive("保留期限必須大於 0")
  .max(MAX_HOLD_TTL_SECONDS, "保留期限不可超過 86400 秒（24 小時）");
const seatsPerHold = wholeNumber("單筆名額上限")
  .min(1, "單筆名額上限至少為 1")
  .max(MAX_SEATS_PER_HOLD, `單筆名額上限不可超過 ${MAX_SEATS_PER_HOLD}`);
const cancellationCutoffSeconds = wholeNumber("取消截止時間")
  .min(0, "取消截止時間不可為負")
  .max(MAX_CANCELLATION_CUTOFF_SECONDS, "取消截止時間不可超過 30 天");

/** 建立資源：保留期限省略時預設 10 分鐘。 */
export const createResourceInput = z.object({
  name,
  holdTtlSeconds: holdTtlSeconds.default(DEFAULT_HOLD_TTL_SECONDS),
  seatsPerHold,
  cancellationCutoffSeconds,
});

/** 修改資源：表單一次送出全部欄位，所以保留期限在這裡是必填，避免省略時悄悄被重設成預設值。 */
export const updateResourceInput = z.object({
  id: resourceId,
  name,
  holdTtlSeconds,
  seatsPerHold,
  cancellationCutoffSeconds,
});

export const createSlotInput = z
  .object({
    resourceId,
    startsAt: slotTime("開始時間"),
    endsAt: slotTime("結束時間"),
    capacity: wholeNumber("容量")
      .min(1, "容量至少為 1")
      .max(MAX_CAPACITY, `容量不可超過 ${MAX_CAPACITY}`),
  })
  .refine((slot) => slot.startsAt < slot.endsAt, {
    path: ["endsAt"],
    error: "結束時間必須晚於開始時間",
  });

export const listSlotHoldsAndBookingsInput = z.object({ slotId: wholeNumber("時段").positive("時段編號無效") });
export const cancelBookingInput = z.object({
  slotId: wholeNumber("時段").positive("時段編號無效"),
  bookingId: wholeNumber("訂位").positive("訂位編號無效"),
});

export type CreateResourceInput = z.output<typeof createResourceInput>;
export type UpdateResourceInput = z.output<typeof updateResourceInput>;
export type CreateSlotInput = z.output<typeof createSlotInput>;
