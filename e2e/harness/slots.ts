import type { Locator, Page } from "@playwright/test";

/**
 * 各 spec 保留用的時段角色。E2E 共用同一份 seed，會員又受「同一時段最多一筆有效保留」與「同時最多 3 筆有效保留」限制，
 * 所以同一位會員的每則會建立保留的測試各拿不同時段（不同會員之間可以重用同一時段），
 * 由這裡統一決定索引，spec 不直接寫 nth／last。
 *
 * 前提（來自 apps/app/seed/seed.sql；改 seed 時要一併檢查）：
 * - 「大廳用餐」有 3 個時段，都在明天以後、尚未開始，依時間排序為第 0、1、2 個；
 * - 「包廂」有 2 個時段，同樣尚未開始；
 * - 其他會員的保留只佔一個名額，不會讓任何時段額滿，所以「有保留按鈕」的卡片順序穩定。
 */
const SLOT_ROLES = {
  main: { resource: "大廳用餐", index: 0 },
  "double-submit": { resource: "大廳用餐", index: 1 },
  countdown: { resource: "大廳用餐", index: 2 },
  "double-submit-confirm": { resource: "包廂", index: 0 },
  "no-js": { resource: "包廂", index: 1 },
  // 專供「送出會被伺服器拒絕」的測試：該會員從不在這個時段建立保留，才不會先撞到 already_in_slot
  "double-submit-rejected": { resource: "大廳用餐", index: 2 },
} as const;

export type SlotRole = keyof typeof SLOT_ROLES;

/** 首頁上該角色專用的時段卡片（只計有「保留」按鈕的卡片，不假設卡片一定可保留）。 */
export function holdableSlot(page: Page, role: SlotRole): Locator {
  const { resource, index } = SLOT_ROLES[role];
  return page
    .getByRole("article", { name: resource })
    .filter({ has: page.getByRole("button", { name: "保留" }) })
    .nth(index);
}
