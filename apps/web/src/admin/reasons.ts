import { describeReason } from "../shared/reasons";

export interface Failure {
  message: string;
  /** 欄位名稱 → 錯誤訊息（訊息由 App 的驗證產生，已是可顯示的文字）。 */
  fields: Record<string, string[]>;
}

const MESSAGES: Record<string, string> = {
  resource_not_found: "找不到這個資源",
  slot_overlaps: "與其他時段重疊",
  slot_not_found: "找不到這個時段",
  slot_in_use: "時段仍有保留或訂位紀錄（過期或已釋放的保留除外）",
  invalid_input: "輸入有誤，請修正後再送出",
  member_not_found: "找不到這位會員",
  booking_not_found: "找不到這筆訂位",
  slot_started: "時段已開始，無法取消",
};

/** 把管理 RPC 的失敗結果轉成表單上顯示的訊息；`unauthorized` 由頁面另外處理（403）。 */
export function describeFailure(result: {
  ok: false;
  reason: string;
  fields?: Record<string, string[]>;
}): Failure {
  return { message: describeReason(MESSAGES, result.reason, "管理操作"), fields: result.fields ?? {} };
}
