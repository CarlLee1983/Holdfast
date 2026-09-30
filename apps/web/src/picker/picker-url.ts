import { loginUrlForPath } from "../auth/member";

export interface PickerSelection {
  seats: number;
  date: string;
  slot?: number;
}

/** 首頁帶著這組選擇的網址；沒有時段時只帶人數與日期。值來自解析後的選擇，不是原始 query，所以不會帶出無效參數。 */
export function pickerPath({ seats, date, slot }: PickerSelection): string {
  const params = new URLSearchParams({ seats: String(seats), date });
  if (slot !== undefined) params.set("slot", String(slot));
  return `/?${params}`;
}

/** 未登入選了時段：導到登入頁，登入後回到首頁並還原這組選擇（GET 不建立保留，要再按一次主按鈕）。 */
export function pickerLoginUrl(selection: Required<PickerSelection>): string {
  return loginUrlForPath(pickerPath(selection));
}
