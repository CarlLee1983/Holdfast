import { describeReason } from "../shared/reasons";

export interface Failure {
  message: string;
  /** 欄位名稱 → 錯誤訊息（訊息由 App 的驗證產生，已是可顯示的文字）。 */
  fields: Record<string, string[]>;
}

const MESSAGES: Record<string, string> = {
  resource_not_found: "找不到這個資源",
  resource_retired: "資源已停用，無法建立時段",
  slot_overlaps: "與其他時段重疊",
  slot_not_found: "找不到這個時段",
  slot_in_use: "時段仍有保留或訂位紀錄（過期或已釋放的保留除外）",
  invalid_input: "輸入有誤，請修正後再送出",
  member_not_found: "找不到這位會員",
  booking_not_found: "找不到這筆訂位",
  slot_started: "時段已開始，無法取消",
  slot_batch_empty: "區間內沒有符合條件的時段，請調整日期、星期或開始時間",
  slot_batch_too_large: "一次最多產生 200 個時段，請縮短區間或減少開始時間",
  slot_batch_overlaps_itself: "這批時段彼此重疊（時段長度大於開始時間的間隔），請調整",
};

/** 把管理 RPC 的失敗結果轉成表單上顯示的訊息；`unauthorized` 由頁面另外處理（403）。 */
export function describeFailure(result: {
  ok: false;
  reason: string;
  fields?: Record<string, string[]>;
}): Failure {
  return { message: describeReason(MESSAGES, result.reason, "管理操作"), fields: result.fields ?? {} };
}

export type FailureStatus = 403 | 404 | 409 | 422 | 500;

const FAILURE_STATUS: Record<string, FailureStatus | undefined> = {
  unauthorized: 403,
  invalid_input: 422,
  member_not_found: 404,
  booking_not_found: 404,
  slot_started: 409,
};

/** 管理 RPC 失敗原因對應的 HTTP 狀態；沒列出的原因用 `fallback`（各頁依情境決定）。 */
export function failureStatus(reason: string, fallback: FailureStatus = 500): FailureStatus {
  return FAILURE_STATUS[reason] ?? fallback;
}
