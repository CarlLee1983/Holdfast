import { describeReason } from "../shared/reasons";

const DELETE_ACCOUNT_MESSAGES: Record<string, string> = {
  invalid_input: "輸入有誤",
};

/** 刪除帳號失敗的 reason 轉成給會員看的訊息；未知的 reason 不外洩，只寫進 log。 */
export function describeDeleteAccountFailure(reason: string): string {
  return describeReason(DELETE_ACCOUNT_MESSAGES, reason, "刪除帳號");
}
