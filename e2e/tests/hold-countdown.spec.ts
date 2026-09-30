import { expect, test } from "@playwright/test";
import { COUNTDOWN_SESSION } from "../harness/constants";
import { confirmButton, pickSlot } from "../harness/slots";
import { memberSessionCookie } from "../harness/session-cookie";

// 只驗證瀏覽器端：快轉的是瀏覽器時鐘，伺服器的到期判定不在這裡測。
// 用專用會員（不與 main-flow 共用有效保留的名額限制）；保留的時段見 harness/slots.ts。
// 兩則測試各用不同資源的時段，遠低於同時 3 筆的上限，也不依賴彼此的順序。
// 快轉量取遠大於任何合理保留期限的 24 小時，而不引用 seed 的 hold_ttl_seconds：測試不必隨 TTL 設定調整。
const FAST_FORWARD_MS = 24 * 60 * 60 * 1000;

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([memberSessionCookie(COUNTDOWN_SESSION)]);
  await page.clock.install();
});

test("確認頁的保留倒數：歸零後顯示已到期、確認訂位按鈕停用並播報", async ({ page }) => {
  await (await pickSlot(page, "countdown")).click();
  await expect(page).toHaveURL(/\/holds\/\d+$/);

  await expect(page.getByText(/^\d{2,}:\d{2}$/)).toBeVisible();
  await expect(confirmButton(page)).toBeEnabled();

  await page.clock.fastForward(FAST_FORWARD_MS);

  await expect(page.getByText("已到期", { exact: true })).toBeVisible();
  await expect(confirmButton(page)).toBeDisabled();
  // 共用播報區（視覺隱藏、預先存在）含到期訊息；它沒有 role，不影響其他測試的 getByRole("status")
  await expect(page.locator("#hold-announcer")).toContainText("已到期");
});

test("會員頁的保留倒數：有繼續確認連結（沒有確認按鈕），歸零後顯示已到期並隱藏連結", async ({ page }) => {
  await (await pickSlot(page, "countdown-list")).click();
  await expect(page).toHaveURL(/\/holds\/\d+$/);
  const holdPath = new URL(page.url()).pathname;

  await page.goto("/me");
  // 同一位會員在「大廳用餐」還可能有另一則測試留下的保留，用資源名稱鎖定本則的「包廂」保留
  const hold = page.getByRole("region", { name: "我的保留" }).getByRole("article", { name: /包廂/ });
  await expect(hold.getByText(/^\d{2,}:\d{2}$/)).toBeVisible();
  await expect(hold.getByRole("button", { name: "確認訂位" })).toHaveCount(0);
  await expect(hold.getByRole("link", { name: "繼續確認" })).toHaveAttribute("href", holdPath);

  await page.clock.fastForward(FAST_FORWARD_MS);

  await expect(hold.getByText("已到期", { exact: true })).toBeVisible();
  // 已到期的保留再點進去只會是 404，所以連結隱藏
  await expect(hold.getByRole("link", { name: "繼續確認" })).toBeHidden();
  await expect(page.locator("#hold-announcer")).toContainText("已到期");
});
