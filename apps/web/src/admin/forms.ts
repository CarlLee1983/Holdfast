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
  };
  const ttlRaw = form.get("holdTtlSeconds");
  const ttl = id === undefined && isBlank(ttlRaw) ? {} : { holdTtlSeconds: toNumber(ttlRaw) };
  return id === undefined ? { ...input, ...ttl } : { id, ...input, ...ttl };
}

/** 時段表單 → RPC 輸入；時間欄位是台北時間，轉成 UTC epoch 毫秒。 */
export function slotFormToInput(form: FormLike, resourceId: number) {
  return {
    resourceId,
    startsAt: parseTaipeiDateTime(form.get("startsAt")) ?? Number.NaN,
    endsAt: parseTaipeiDateTime(form.get("endsAt")) ?? Number.NaN,
    capacity: toNumber(form.get("capacity")),
  };
}

/** 調整時段容量表單 → RPC 輸入；不判斷容量與占用的關係（調到低於占用是合法的，形成超占）。 */
export function slotCapacityFormToInput(form: FormLike) {
  return { slotId: toNumber(form.get("slotId")), capacity: toNumber(form.get("capacity")) };
}

/** 刪除時段表單 → RPC 輸入。 */
export function slotIdFormToInput(form: FormLike) {
  return { slotId: toNumber(form.get("slotId")) };
}

/** 表單 → 字串記錄（略過檔案欄位），送出失敗時用來把使用者輸入的值填回表單。 */
export function formToRecord(form: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of form) {
    if (typeof value === "string") record[key] = value;
  }
  return record;
}
