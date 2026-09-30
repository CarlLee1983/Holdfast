const actions: Record<string, string> = {
  "resource.create": "建立資源",
  "resource.update": "修改資源",
  "slot.create": "建立時段",
  "slot.update_capacity": "調整時段容量",
  "slot.delete": "刪除時段",
  "booking.cancel": "取消訂位",
};

export function auditAction(action: string): string {
  return Object.hasOwn(actions, action) ? `${actions[action]}（${action}）` : action;
}

export function auditDetail(detail: string): { display: string; raw: string | null } {
  try {
    const formatted = JSON.stringify(JSON.parse(detail), null, 2);
    return { display: formatted, raw: formatted === detail ? null : detail };
  } catch {
    return { display: detail, raw: null };
  }
}

/** Query 字串保留原始非法值交給 RPC，讓 App 先驗 JWT 再驗輸入。 */
export function auditCursor(raw: string | null): number | string | undefined {
  if (raw === null) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) return raw;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : raw;
}
