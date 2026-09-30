// 依人數篩選：單筆名額上限小於人數的資源，它的時段不列出。

interface ResourceLimit {
  name: string;
  seatsPerHold: number;
}

/** 所有資源中最大的單筆名額上限，也是人數下拉的最大值；沒有資源時為 0。 */
export function maxSeatsPerHold(resources: readonly ResourceLimit[]): number {
  return resources.reduce((max, r) => Math.max(max, r.seatsPerHold), 0);
}

/** 只留下容得下這個人數的時段。不改動輸入。 */
export function filterSlotsBySeats<T extends { seatsPerHold: number }>(slots: readonly T[], seats: number): T[] {
  return slots.filter((slot) => slot.seatsPerHold >= seats);
}

/** 因人數過多而不列出時段的資源，保持輸入順序。 */
export function hiddenResources<T extends ResourceLimit>(resources: readonly T[], seats: number): T[] {
  return resources.filter((r) => r.seatsPerHold < seats);
}

/** 被隱藏資源的提示；沒有被隱藏的資源就沒有提示。 */
export function hiddenResourcesNote(hidden: readonly ResourceLimit[]): string | null {
  if (hidden.length === 0) return null;
  const limits = hidden.map((r) => `${r.name}最多 ${r.seatsPerHold} 位`).join("、");
  return `${limits}，這個人數不列出${hidden.length > 1 ? "它們" : "它"}的時段。`;
}

/** 人數欄下方的說明：線上上限與超過時的來電電話。 */
export function onlineLimitNote(maxSeats: number, phone: string): string {
  return `線上可訂 1–${maxSeats} 位；超過 ${maxSeats} 位請來電 ${phone}。`;
}
