import { describeReason } from "../shared/reasons";

const MESSAGES: Record<string, string> = {
  insufficient_seats: "剩餘名額不足，請改選其他時段或減少名額",
  seats_per_hold_exceeded: "超過這個資源的單筆名額上限",
  slot_started: "時段已開始，無法保留",
  already_in_slot: "你在這個時段已有有效的保留或訂位",
  active_hold_limit_reached: "你持有的有效保留已達上限，請先確認或等待到期後再保留",
  slot_overcommitted: "這個時段目前無法接受新的保留",
  slot_not_found: "找不到這個時段",
  idempotency_key_conflict: "這個保留請求已送出過，請重新整理頁面後再試",
  invalid_input: "輸入有誤",
};

/** 建立保留失敗的 reason 轉成給會員看的訊息；未知的 reason 不外洩，只寫進 log。 */
export function describeHoldFailure(reason: string): string {
  return describeReason(MESSAGES, reason, "建立保留");
}

/** 輸入有誤是 422，其餘業務拒絕（名額、時間、冪等鍵衝突）是 409。 */
export function holdFailureStatus(reason: string): 409 | 422 {
  return reason === "invalid_input" ? 422 : 409;
}
