import { expect, test } from "@playwright/test";
import { holdableSlot } from "../harness/slots";
import { memberSessionCookie } from "../harness/session-cookie";

test("會員主流程：登入 → 看到時段 → 保留 → 確認 → 會員頁看到訂位 → 取消", async ({ page, context }) => {
  await context.addCookies([memberSessionCookie()]);

  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1, name: "我的保留與訂位" })).toBeVisible();

  // 資源與時段來自 seed。「大廳用餐」的第一個時段是明天（UTC）03:00，離開始至少 3 小時，
  // 而取消截止是開始前 2 小時，所以後面的取消一定在截止前；改 seed 時要維持這個前提
  await page.goto("/");
  // 時段依台北日期分組，每組有含星期的日期標題（例如「9/30（週三）」）
  await expect(page.getByRole("heading", { level: 2, name: /^\d{1,2}\/\d{1,2}（週.）$/ }).first()).toBeVisible();
  await expect(page.getByRole("article", { name: "包廂" }).first()).toBeVisible();
  // 保留的時段見 harness/slots.ts
  const lobby = holdableSlot(page, "main");
  await lobby.getByRole("button", { name: "保留" }).click();

  await expect(page).toHaveURL(/\/me\?held=\d+$/);
  await expect(page.getByRole("status")).toContainText("保留成功");
  // 保留卡片的可及名稱是「資源名稱＋日期＋時間」，限定在「我的保留」區塊內
  const holds = page.getByRole("region", { name: "我的保留" });
  await expect(holds.getByRole("article", { name: /大廳用餐/ })).toHaveCount(1);

  await page.getByRole("button", { name: "確認訂位" }).click();
  await expect(page.getByRole("status")).toHaveText("訂位成功");
  await expect(page.getByText("目前沒有有效的保留")).toBeVisible();
  const booking = page.getByRole("region", { name: "我的訂位" }).getByRole("article", { name: /大廳用餐/ });
  await expect(booking).toContainText("已訂位");

  await booking.getByRole("button", { name: "取消訂位" }).click();
  await expect(page.getByRole("status")).toHaveText("已取消訂位");
  await expect(page.getByText("目前沒有訂位")).toBeVisible();
});
