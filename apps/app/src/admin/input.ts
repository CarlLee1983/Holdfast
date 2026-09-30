import { z } from "zod";
import { MAX_SEATS_PER_HOLD, wholeNumber } from "../shared/input";
import { DAY_MS, parseCalendarDate } from "./slot-batch";

const DEFAULT_HOLD_TTL_SECONDS = 600;

// 上限：擋掉明顯的手誤與亂填（例如 12 位數的時間、超長名稱），不是業務規則
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_CANCELLATION_REASON_LENGTH = 200;
const MAX_HOLD_TTL_SECONDS = 86_400;
const MAX_CANCELLATION_CUTOFF_SECONDS = 30 * 86_400;
const MAX_CAPACITY = 100_000;
/** 時段時間的合理範圍（UTC epoch 毫秒，含邊界）：2020-01-01 至 2100-01-01。 */
const MIN_SLOT_TIME = Date.UTC(2020, 0, 1);
const MAX_SLOT_TIME = Date.UTC(2100, 0, 1);

const resourceId = wholeNumber("資源").positive("資源編號無效");

const slotId = wholeNumber("時段").positive("時段編號無效");

const capacity = wholeNumber("容量")
  .min(1, "容量至少為 1")
  .max(MAX_CAPACITY, `容量不可超過 ${MAX_CAPACITY}`);

const slotTime = (label: string) =>
  wholeNumber(label)
    .min(MIN_SLOT_TIME, `${label}不可早於 2020-01-01`)
    .max(MAX_SLOT_TIME, `${label}不可晚於 2100-01-01`);

const name = z
  .string({ error: "名稱必須是文字" })
  .trim()
  .min(1, "名稱不可為空")
  .max(MAX_NAME_LENGTH, `名稱不可超過 ${MAX_NAME_LENGTH} 個字`);

/** 純文字說明：去掉前後空白，空白存 null。 */
const description = z
  .string({ error: "說明必須是文字" })
  .trim()
  .max(MAX_DESCRIPTION_LENGTH, `說明不可超過 ${MAX_DESCRIPTION_LENGTH} 個字`)
  .transform((value) => value || null);

/** 取消原因（給會員看的純文字）：去掉前後空白，空白存 null。 */
const cancellationReason = z
  .string({ error: "取消原因必須是文字" })
  .trim()
  .max(MAX_CANCELLATION_REASON_LENGTH, `取消原因不可超過 ${MAX_CANCELLATION_REASON_LENGTH} 個字`)
  .transform((value) => value || null);

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
  description: description.default(null),
});

/** 修改資源：表單一次送出全部欄位，所以保留期限與說明在這裡是必填，避免省略時悄悄被重設成預設值。 */
export const updateResourceInput = z.object({
  id: resourceId,
  name,
  holdTtlSeconds,
  seatsPerHold,
  cancellationCutoffSeconds,
  description,
});

const endsAfterStart = {
  check: (slot: { startsAt: number; endsAt: number }) => slot.startsAt < slot.endsAt,
  params: { path: ["endsAt"] as PropertyKey[], error: "結束時間必須晚於開始時間" },
};

export const createSlotInput = z
  .object({
    resourceId,
    startsAt: slotTime("開始時間"),
    endsAt: slotTime("結束時間"),
    capacity,
  })
  .refine(endsAfterStart.check, endsAfterStart.params);

const MAX_BATCH_DAYS = 90;
const MAX_BATCH_START_TIMES = 48;
const MAX_BATCH_DURATION_MINUTES = 1440;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// 批次的台北日期界線要保證展開結果落在單筆時段的 UTC 界線（MIN/MAX_SLOT_TIME）內，所以各差一天以上：
// 台北 00:00 = 前一天 UTC 16:00，fromDate 若是 MIN_SLOT_TIME 當天，最早的時段會落在界線之前；
// 最晚開始 23:59 加上最長 1440 分鐘會跨到隔天，toDate 再往前一天，結束時間才不會超過 MAX_SLOT_TIME。
const MIN_BATCH_DATE = isoDate(MIN_SLOT_TIME + DAY_MS);
const MAX_BATCH_DATE = isoDate(MAX_SLOT_TIME - 2 * DAY_MS);
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 台北日曆日 "YYYY-MM-DD"：格式、日期本身、範圍（字串比較即日期比較）。 */
const calendarDate = (label: string) =>
  z
    .string({ error: `${label}必須是文字` })
    .refine((value) => parseCalendarDate(value) !== null, `${label}必須是 YYYY-MM-DD 格式的有效日期`)
    .refine((value) => value >= MIN_BATCH_DATE, `${label}不可早於 ${MIN_BATCH_DATE}`)
    .refine((value) => value <= MAX_BATCH_DATE, `${label}不可晚於 ${MAX_BATCH_DATE}`);

const hasNoDuplicates = <T>(values: T[]) => new Set(values).size === values.length;

/** 批次建立時段（預覽與寫入共用）：日期是台北日曆日、含頭尾；開始時間是台北時間。 */
export const createSlotBatchInput = z
  .object({
    resourceId,
    fromDate: calendarDate("開始日期"),
    toDate: calendarDate("結束日期"),
    weekdays: z
      .array(wholeNumber("星期").min(0, "星期必須介於 0（週日）到 6（週六）").max(6, "星期必須介於 0（週日）到 6（週六）"), {
        error: "星期必須是清單",
      })
      .min(1, "至少選擇一個星期")
      .refine(hasNoDuplicates, "星期不可重複"),
    startTimes: z
      .array(z.string({ error: "開始時間必須是文字" }).regex(CLOCK_TIME, "開始時間必須是 HH:mm 格式（00:00 至 23:59）"), {
        error: "開始時間必須是清單",
      })
      .min(1, "至少設定一個開始時間")
      .max(MAX_BATCH_START_TIMES, `開始時間不可超過 ${MAX_BATCH_START_TIMES} 個`)
      .refine(hasNoDuplicates, "開始時間不可重複"),
    durationMinutes: wholeNumber("時段長度")
      .min(1, "時段長度至少為 1 分鐘")
      .max(MAX_BATCH_DURATION_MINUTES, `時段長度不可超過 ${MAX_BATCH_DURATION_MINUTES} 分鐘`),
    capacity,
  })
  .refine((batch) => batch.toDate >= batch.fromDate, { path: ["toDate"], error: "結束日期不可早於開始日期" })
  .refine(
    (batch) => (parseCalendarDate(batch.toDate)! - parseCalendarDate(batch.fromDate)!) / DAY_MS + 1 <= MAX_BATCH_DAYS,
    { path: ["toDate"], error: `日期區間不可超過 ${MAX_BATCH_DAYS} 天` },
  );

/** 調整容量：可調到低於已占用（形成超占，CONTEXT.md），所以只驗容量本身的範圍。 */
export const updateSlotCapacityInput = z.object({ slotId, capacity });

/** 修改時段時間：只驗時間本身；是否有人占用與是否重疊由 service 在寫入時判定。 */
export const updateSlotTimeInput = z
  .object({ slotId, startsAt: slotTime("開始時間"), endsAt: slotTime("結束時間") })
  .refine(endsAfterStart.check, endsAfterStart.params);

export const deleteSlotInput = z.object({ slotId });

const HOUR_MS = 3_600_000;
/** 日程表區間上限：一次查一天，留一天餘裕給前端；只用來限制查詢大小，不是業務規則。 */
const MAX_AGENDA_RANGE_MS = 48 * HOUR_MS;

/** 日程表：UTC epoch 毫秒的半開區間 [from, to)，依 `slots.starts_at` 篩選；換算台北日界線是 Web 的事。 */
export const listAgendaInput = z
  .object({
    from: wholeNumber("起始時間"),
    to: wholeNumber("結束時間"),
    resourceId: resourceId.optional(),
  })
  .refine((range) => range.to > range.from, {
    path: ["to"],
    error: "結束時間必須晚於起始時間",
  })
  .refine((range) => range.to - range.from <= MAX_AGENDA_RANGE_MS, {
    path: ["to"],
    error: "查詢區間不可超過 48 小時",
  });

const MAX_MEMBER_QUERY_LENGTH = 200;
const MAX_MEMBER_ID_LENGTH = 255;

/** 查會員：名稱或 email 的部分字串；修剪後不可為空（空查詢會列出所有會員，沒有意義）。 */
export const searchMembersInput = z.object({
  query: z
    .string({ error: "搜尋關鍵字必須是文字" })
    .trim()
    .min(1, "請輸入名稱或 email")
    .max(MAX_MEMBER_QUERY_LENGTH, `搜尋關鍵字不可超過 ${MAX_MEMBER_QUERY_LENGTH} 個字`),
});

export const getMemberInput = z.object({
  memberId: z
    .string({ error: "會員必須是文字" })
    .min(1, "會員編號無效")
    .max(MAX_MEMBER_ID_LENGTH, "會員編號無效"),
});

export const listSlotHoldsAndBookingsInput = z.object({ slotId });
export const cancelBookingInput = z.object({
  slotId,
  bookingId: wholeNumber("訂位").positive("訂位編號無效"),
  reason: cancellationReason.default(null),
});

export type CreateResourceInput = z.output<typeof createResourceInput>;
export type UpdateResourceInput = z.output<typeof updateResourceInput>;
export type CreateSlotInput = z.output<typeof createSlotInput>;
export type CreateSlotBatchInput = z.output<typeof createSlotBatchInput>;
export type UpdateSlotCapacityInput = z.output<typeof updateSlotCapacityInput>;
export type UpdateSlotTimeInput = z.output<typeof updateSlotTimeInput>;
export type DeleteSlotInput = z.output<typeof deleteSlotInput>;

export const getResourceInput = resourceId;

/** 稽核頁使用上一頁最後一筆 ID；省略 cursor 代表最新紀錄。 */
export const listAuditInput = z.object({
  cursor: z.number({ error: "游標必須是數字" }).int("游標必須是整數").safe("游標超出安全範圍").positive("游標必須大於 0").optional(),
});
