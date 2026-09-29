import { formatTaipeiDayHeading, taipeiDateKey } from "./taipei-time";

export interface DateGroup<T> {
  /** 台北日期，格式 YYYY-MM-DD，可直接字串排序。 */
  date: string;
  /** 顯示用標題，例如「9/30（週三）」。 */
  heading: string;
  slots: T[];
}

/**
 * 把時段依台北日期分組。日期組依時間先後；組內依開始時間排序，
 * 同時間再依資源名稱排序。不改動輸入。
 */
export function groupSlotsByTaipeiDate<T extends { startsAt: number; resourceName: string }>(
  slots: readonly T[],
): DateGroup<T>[] {
  // 資源名稱用字碼順序比較，不依賴執行環境的 locale 排序規則，結果才穩定
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...slots].sort((a, b) => a.startsAt - b.startsAt || byName(a.resourceName, b.resourceName));

  const groups: DateGroup<T>[] = [];
  for (const slot of sorted) {
    const date = taipeiDateKey(slot.startsAt);
    const last = groups[groups.length - 1];
    if (last?.date === date) {
      last.slots.push(slot);
    } else {
      groups.push({ date, heading: formatTaipeiDayHeading(slot.startsAt), slots: [slot] });
    }
  }
  return groups;
}

/** 把「資源＋其時段」攤平成單一時段列表，每筆帶上資源名稱與單筆名額上限。 */
export function flattenCatalog<S>(
  catalog: readonly { resource: { name: string; seatsPerHold: number }; slots: readonly S[] }[],
): (S & { resourceName: string; seatsPerHold: number })[] {
  return catalog.flatMap(({ resource, slots }) =>
    slots.map((slot) => ({ ...slot, resourceName: resource.name, seatsPerHold: resource.seatsPerHold })),
  );
}
