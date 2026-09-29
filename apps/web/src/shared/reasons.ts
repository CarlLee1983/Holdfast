/** invalid_input 的訊息後面附第一個欄位錯誤；欄位錯誤由 App 的驗證產生，已是可顯示的文字。 */
export function withFirstFieldDetail(message: string, fields: Record<string, string[]>): string {
  const detail = Object.values(fields).flat()[0];
  return detail ? `${message}：${detail}` : message;
}

export const GENERIC_MESSAGE = "操作失敗，請稍後再試";

/**
 * 查具名 reason 的訊息；查不到就回通用訊息，內部代碼只寫進 console.error，不給使用者看。
 * `context` 是 log 用的操作名稱（例如「管理操作」）。
 */
export function describeReason(
  messages: Record<string, string>,
  reason: string,
  context: string,
): string {
  const known = messages[reason];
  if (known === undefined) {
    console.error(`未預期的${context}失敗原因：${reason}`);
  }
  return known ?? GENERIC_MESSAGE;
}
