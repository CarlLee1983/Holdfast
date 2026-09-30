import { expect, type Locator, type Page } from "@playwright/test";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TAIPEI_OFFSET_MS = 8 * HOUR_MS;

/**
 * 各 spec 保留用的時段角色。E2E 共用同一份 seed，會員又受「同一時段最多一筆有效保留」與「同時最多 3 筆有效保留」限制，
 * 所以同一位會員的每則會建立保留的測試各拿不同時段（不同會員之間可以重用同一時段），
 * 由這裡統一決定是哪個時段，spec 不直接寫日期或時間。
 *
 * 前提（來自 apps/app/seed/seed.sql；改 seed 時要一併檢查）：seed 的時段是「UTC 今天起算 +N 天」的固定小時，
 * 都在明天以後、尚未開始，換成台北時間（UTC+8）就是可推算的日期與時間：
 * - 大廳用餐：+1 天 03:00Z（台北 11:00）、+1 天 11:00Z（19:00）、+2 天 11:00Z（19:00）；
 * - 包廂：+1 天 11:00Z（19:00）、+2 天 02:00Z（10:00）；
 * - 每筆保留佔 2 位（`pickSlot` 固定 `seats=2`）。共用最多的包廂 +1 天 11:00Z（容量 10）有三個會保留的角色，最多佔 6 位，
 *   至少剩 4 位，所以選 2 位一定還能按，只選不保留的 login-resume 選 3 位也一定能按；
 *   但剩餘位數隨其他 spec 的執行順序變動，其他超過這個餘量的斷言不能假設它有幾位可訂；
 * - 人數 2 位在兩個資源的單筆名額上限內，首頁一定列出這些時段。
 */
const SLOT_ROLES = {
  main: { resource: "大廳用餐", dayOffset: 1, utcHour: 3 },
  "double-submit": { resource: "大廳用餐", dayOffset: 1, utcHour: 11 },
  countdown: { resource: "大廳用餐", dayOffset: 2, utcHour: 11 },
  // 倒數會員的第二個時段（會員頁倒數的測試用）；與 double-submit-confirm 同一時段，但屬於不同會員
  "countdown-list": { resource: "包廂", dayOffset: 1, utcHour: 11 },
  "double-submit-confirm": { resource: "包廂", dayOffset: 1, utcHour: 11 },
  "no-js": { resource: "包廂", dayOffset: 2, utcHour: 2 },
  // 確認頁／完成頁「別人的保留與訂位」測試的擁有者（HOLD_OWNER_MEMBER）專用。該會員的「別人的保留」測試已用 main 留下一筆有效保留，
  // 而同一會員同一時段只能有一筆有效的保留或訂位，所以這兩個角色各用一個不同於 main 的時段；測試會確認它們，確認後不佔有效保留的額度
  "booking-owner": { resource: "包廂", dayOffset: 1, utcHour: 11 },
  "booking-owner-redirect": { resource: "大廳用餐", dayOffset: 2, utcHour: 11 },
  // 專供「送出會被伺服器拒絕」的測試：該會員從不在這個時段建立保留，才不會先撞到 already_in_slot
  "double-submit-rejected": { resource: "大廳用餐", dayOffset: 2, utcHour: 11 },
  // 未登入選時段的登入銜接：只選不保留，不佔名額；選 3 位（不是預設的 2 位）才驗得出人數有被還原，餘量見檔頭
  "login-resume": { resource: "包廂", dayOffset: 1, utcHour: 11 },
} as const;

export type SlotRole = keyof typeof SLOT_ROLES;

export interface SlotInfo {
  resource: string;
  /** 台北日期，YYYY-MM-DD，也是首頁 `date` 參數的值。 */
  date: string;
  /** 台北時間 HH:mm。 */
  time: string;
  /** 首頁時段按鈕的可及名稱，例如「19:00 大廳用餐」。 */
  buttonName: string;
}

/** 該角色專用時段的台北日期與時間，從 seed 的「UTC 今天起算 +N 天＋固定小時」推算。 */
export function slotInfo(role: SlotRole): SlotInfo {
  const { resource, dayOffset, utcHour } = SLOT_ROLES[role];
  const utcMidnight = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const taipei = new Date(utcMidnight + dayOffset * DAY_MS + utcHour * HOUR_MS + TAIPEI_OFFSET_MS).toISOString();
  const time = taipei.slice(11, 16);
  return { resource, date: taipei.slice(0, 10), time, buttonName: `${time} ${resource}` };
}

/** 首頁上該角色專用的時段按鈕。 */
export function slotButton(page: Page, role: SlotRole): Locator {
  return page.getByRole("button", { name: slotInfo(role).buttonName, exact: true });
}

/** 首頁底部摘要列的主按鈕；選了時段時寫「保留這個時段」。 */
export function holdButton(page: Page): Locator {
  return page.getByRole("button", { name: "保留這個時段" });
}

/** 確認頁的主按鈕「確認訂位」。 */
export function confirmButton(page: Page): Locator {
  return page.getByRole("button", { name: "確認訂位" });
}

/** 直接以網址選好人數與日期，點該角色的時段，等它被選中，回傳「保留這個時段」按鈕。 */
export async function pickSlot(page: Page, role: SlotRole): Promise<Locator> {
  await page.goto(`/?seats=2&date=${slotInfo(role).date}`);
  await slotButton(page, role).click();
  await expect(slotButton(page, role)).toHaveAttribute("aria-pressed", "true");
  return holdButton(page);
}

/**
 * 操作首頁的下拉選單（有 JS 時變動即自動送出 GET），等新頁面載入完成才返回。
 * 等到 load 是為了確保新頁面的 script 已掛上監聽，下一次選單操作才會自動送出。
 */
export async function chooseOption(page: Page, label: "用餐人數" | "用餐日期", value: string): Promise<void> {
  const param = label === "用餐人數" ? "seats" : "date";
  await page.getByLabel(label).selectOption(value);
  await page.waitForURL((url) => url.searchParams.get(param) === value);
}
