import { expect, test } from "@playwright/test";
import { COUNTDOWN_SESSION } from "../harness/constants";
import { pickSlot } from "../harness/slots";
import { memberSessionCookie } from "../harness/session-cookie";

// 只驗證瀏覽器端：快轉的是瀏覽器時鐘，伺服器的到期判定不在這裡測。
// 用專用會員（不與 main-flow 共用有效保留的名額限制）；保留的時段見 harness/slots.ts。
// 快轉量取遠大於任何合理保留期限的 24 小時，而不引用 seed 的 hold_ttl_seconds：測試不必隨 TTL 設定調整。
const FAST_FORWARD_MS = 24 * 60 * 60 * 1000;

test("保留倒數：歸零後顯示已到期，確認訂位按鈕停用", async ({ page, context }) => {
  await context.addCookies([memberSessionCookie(COUNTDOWN_SESSION)]);
  await page.clock.install();

  await (await pickSlot(page, "countdown")).click();
  await expect(page).toHaveURL(/\/me\?held=\d+$/);

  const hold = page.getByRole("region", { name: "我的保留" }).getByRole("article", { name: /大廳用餐/ });
  await expect(hold.getByText(/^\d{2,}:\d{2}$/)).toBeVisible();
  await expect(hold.getByRole("button", { name: "確認訂位" })).toBeEnabled();

  await page.clock.fastForward(FAST_FORWARD_MS);

  await expect(hold.getByText("已到期")).toBeVisible();
  await expect(hold.getByRole("button", { name: "確認訂位" })).toBeDisabled();
  // 共用播報區（視覺隱藏、預先存在）含到期訊息；它沒有 role，不影響其他測試的 getByRole("status")
  await expect(page.locator("#hold-announcer")).toContainText("已到期");
});
