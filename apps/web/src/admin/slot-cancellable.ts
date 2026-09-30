/**
 * 是否該顯示取消訂位的表單：時段尚未開始（story 22）。
 * 只決定畫面要不要顯示；真正的判定在 App 取消那一句 UPDATE 的條件內（ADR 0004、0011）。
 */
export function slotCancellable(startsAt: number, now: number): boolean {
  return startsAt > now;
}
