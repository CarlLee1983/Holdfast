import { taipeiMinuteOfDay } from "../catalog/taipei-time";

/** 時段的排序：依開始時間，同時間再依資源名稱。名稱用字碼順序比較，不依賴執行環境的 locale 排序規則，結果才穩定。 */
function compareSlots(
  a: { startsAt: number; resourceName: string },
  b: { startsAt: number; resourceName: string },
): number {
  return a.startsAt - b.startsAt || (a.resourceName < b.resourceName ? -1 : a.resourceName > b.resourceName ? 1 : 0);
}

export interface MealGroup<T> {
  meal: "lunch" | "dinner";
  /** 顯示用標題。 */
  label: "午餐" | "晚餐";
  slots: T[];
}

/** 「HH:mm」→ 當天的第幾分鐘。 */
function minuteOfDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/**
 * 時段依台北時間分成午餐與晚餐：開始時間早於 `lunchEndsAt`（HH:mm）的是午餐，其餘是晚餐。
 * 午餐在前；組內依開始時間排序，同時間再依資源名稱排序；沒有時段的組不回傳。不改動輸入。
 * 只看一天內的時刻，呼叫端要先挑好單一日期的時段。
 */
export function groupByMeal<T extends { startsAt: number; resourceName: string }>(
  slots: readonly T[],
  lunchEndsAt: string,
): MealGroup<T>[] {
  const boundary = minuteOfDay(lunchEndsAt);
  const sorted = [...slots].sort(compareSlots);
  const lunch = sorted.filter((s) => taipeiMinuteOfDay(s.startsAt) < boundary);
  const dinner = sorted.filter((s) => taipeiMinuteOfDay(s.startsAt) >= boundary);

  const groups: MealGroup<T>[] = [
    { meal: "lunch", label: "午餐", slots: lunch },
    { meal: "dinner", label: "晚餐", slots: dinner },
  ];
  return groups.filter((g) => g.slots.length > 0);
}
