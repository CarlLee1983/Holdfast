/** 所有 RPC 方法的回傳形狀：業務上的拒絕用具名 reason 表達，不丟例外。 */
export type Result<T, Reason extends string> =
  | { ok: true; data: T }
  | { ok: false; reason: Reason };

export const ok = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });

export const fail = <Reason extends string>(
  reason: Reason,
): { ok: false; reason: Reason } => ({ ok: false, reason });
