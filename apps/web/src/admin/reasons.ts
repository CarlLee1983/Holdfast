export interface Failure {
  message: string;
  /** 欄位名稱 → 錯誤訊息（訊息由 App 的驗證產生，已是可顯示的文字）。 */
  fields: Record<string, string[]>;
}

const GENERIC_MESSAGE = "操作失敗，請稍後再試";

const MESSAGES: Record<string, string> = {
  resource_not_found: "找不到這個資源",
  slot_overlaps: "與這個資源既有的時段重疊",
  invalid_input: "輸入有誤，請修正後再送出",
};

/** 把管理 RPC 的失敗結果轉成表單上顯示的訊息；`unauthorized` 由頁面另外處理（403）。 */
export function describeFailure(result: {
  ok: false;
  reason: string;
  fields?: Record<string, string[]>;
}): Failure {
  const known = MESSAGES[result.reason];
  if (known === undefined) {
    // 內部代碼不給使用者看，只留在 log
    console.error(`未預期的管理操作失敗原因：${result.reason}`);
  }
  return { message: known ?? GENERIC_MESSAGE, fields: result.fields ?? {} };
}
