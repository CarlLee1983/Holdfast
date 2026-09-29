import { parseTaipeiDateTime } from "./taipei-input";

interface FormLike {
  get(name: string): unknown;
}

/**
 * 表單值轉數字。空白或非數字轉成 NaN，不在 Web 判斷規則：
 * 由 App 的 zod 驗證回報欄位錯誤（Web 不決定什麼輸入合法）。
 */
function toNumber(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value);
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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
  const ttlBlank = typeof ttlRaw !== "string" || ttlRaw.trim() === "";
  const ttl = id === undefined && ttlBlank ? {} : { holdTtlSeconds: toNumber(ttlRaw) };
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
