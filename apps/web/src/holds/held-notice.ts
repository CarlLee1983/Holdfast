export type HeldNotice<H> = { kind: "held"; hold: H } | { kind: "missing" } | null;

/**
 * `/me?held=<id>` 的提示：沒帶參數不提示；id 在有效保留裡就是成功；
 * 帶了但找不到（已過期、不存在、亂填）就是 missing。
 */
export function heldNotice<H extends { id: number }>(
  holds: H[],
  param: string | null,
): HeldNotice<H> {
  if (param === null) return null;
  const hold = holds.find((h) => String(h.id) === param);
  return hold ? { kind: "held", hold } : { kind: "missing" };
}
