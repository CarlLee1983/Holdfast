interface SlotOccupancy {
  capacity: number;
  occupied: number;
  /** App 即時算出的超占旗標；Web 只顯示，不自己判斷。 */
  overcommitted: boolean;
}

/** 後台時段列表的狀態欄文字。 */
export function describeOccupancy({ capacity, occupied, overcommitted }: SlotOccupancy): string {
  if (overcommitted) return `超占（多占 ${occupied - capacity} 個名額）`;
  return occupied === capacity ? "已額滿" : "正常";
}
