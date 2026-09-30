import { isBlank, toNumber, toText, type FormLike } from "../shared/form-values";
import { parseTaipeiDateTime } from "./taipei-input";

/**
 * 資源表單 → RPC 輸入。建立時保留期限留空就省略（App 套預設 600 秒）；
 * 修改（帶 `id`）時保留期限必填，留空會變成 NaN 而被 App 拒絕。
 */
export function resourceFormToInput(form: FormLike, id?: number) {
  const input = {
    name: toText(form.get("name")),
    seatsPerHold: toNumber(form.get("seatsPerHold")),
    cancellationCutoffSeconds: toNumber(form.get("cancellationCutoffSeconds")),
    description: toText(form.get("description")),
  };
  const ttlRaw = form.get("holdTtlSeconds");
  const ttl = id === undefined && isBlank(ttlRaw) ? {} : { holdTtlSeconds: toNumber(ttlRaw) };
  return id === undefined ? { ...input, ...ttl } : { id, ...input, ...ttl };
}

/** 開始與結束欄位是台北時間，轉成 UTC epoch 毫秒；無效轉成 NaN，由 App 回報欄位錯誤。 */
function slotTimes(form: FormLike) {
  return {
    startsAt: parseTaipeiDateTime(form.get("startsAt")) ?? Number.NaN,
    endsAt: parseTaipeiDateTime(form.get("endsAt")) ?? Number.NaN,
  };
}

/** 時段表單 → RPC 輸入。 */
export function slotFormToInput(form: FormLike, resourceId: number) {
  return {
    resourceId,
    ...slotTimes(form),
    capacity: toNumber(form.get("capacity")),
  };
}

/** 調整時段容量表單 → RPC 輸入；不判斷容量與占用的關係（調到低於占用是合法的，形成超占）。 */
export function slotCapacityFormToInput(form: FormLike) {
  return { slotId: toNumber(form.get("slotId")), capacity: toNumber(form.get("capacity")) };
}

/** 修改時段時間表單 → RPC 輸入。 */
export function slotTimeFormToInput(form: FormLike) {
  return { slotId: toNumber(form.get("slotId")), ...slotTimes(form) };
}

/** 刪除時段表單 → RPC 輸入。 */
export function slotIdFormToInput(form: FormLike) {
  return { slotId: toNumber(form.get("slotId")) };
}

/** 有多值欄位（同名 checkbox）的表單；URLSearchParams 與 FormData 都符合。 */
export interface MultiValueFormLike extends FormLike {
  getAll(name: string): unknown[];
}

/** 開始時間以半形或全形逗號、頓號或空白分隔，去掉空項；格式與範圍交給 App 驗證。 */
function splitStartTimes(value: unknown): string[] {
  return toText(value)
    .split(/[,，、\s]+/)
    .filter((part) => part !== "");
}

/** 批次建立時段表單 → RPC 輸入；日期原樣帶字串，規則（星期、時間、長度、容量）全由 App 驗證。 */
export function slotBatchFormToInput(form: MultiValueFormLike, resourceId: number) {
  return {
    resourceId,
    fromDate: toText(form.get("fromDate")),
    toDate: toText(form.get("toDate")),
    weekdays: form.getAll("weekdays").map(toNumber),
    startTimes: splitStartTimes(form.get("startTimes")),
    durationMinutes: toNumber(form.get("durationMinutes")),
    capacity: toNumber(form.get("capacity")),
  };
}

/** 表單 → 字串記錄（略過檔案欄位），送出失敗時用來把使用者輸入的值填回表單。 */
export function formToRecord(form: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of form) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}
