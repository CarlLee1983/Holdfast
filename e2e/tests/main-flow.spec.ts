import { expect, test } from "@playwright/test";
import { chooseOption, confirmButton, holdButton, slotButton, slotInfo } from "../harness/slots";
import { memberSessionCookie } from "../harness/session-cookie";

test("會員主流程：登入 → 選人數、日期與時段 → 保留 → 確認頁確認 → 會員頁看到訂位 → 取消", async ({ page, context }) => {
  await context.addCookies([memberSessionCookie()]);

  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1, name: "我的保留與訂位" })).toBeVisible();

  // 資源與時段來自 seed。「大廳用餐」的第一個時段是明天（UTC）03:00，離開始至少 3 小時，
  // 而取消截止是開始前 2 小時，所以後面的取消一定在截止前；改 seed 時要維持這個前提
  await page.goto("/");
  // 有 JS 時選單一變動就自動送出 GET，選擇存在網址裡；保留的時段見 harness/slots.ts
  const { date } = slotInfo("main");
  await chooseOption(page, "用餐人數", "3");
  await chooseOption(page, "用餐日期", date);

  // 還沒選時段：主按鈕不能按
  await expect(page.getByRole("button", { name: "請選擇用餐時段" })).toBeDisabled();
  await slotButton(page, "main").click();
  await expect(slotButton(page, "main")).toHaveAttribute("aria-pressed", "true");
  await holdButton(page).click();

  // 保留後進入專屬的確認頁；確認只在這一頁發生
  await expect(page).toHaveURL(/\/holds\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: "確認訂位" })).toBeVisible();
  const detail = page.getByRole("main");
  await expect(detail).toContainText("3 位");
  await expect(detail).toContainText("大廳用餐");
  await expect(detail).toContainText("面向開放廚房的長桌與雙人座");
  await expect(detail).toContainText("以E2E 會員的身分訂位");
  const notes = page.getByRole("region", { name: "訂位須知" });
  await expect(notes).toContainText("保留 10 分鐘，逾時自動釋放");
  await expect(notes).toContainText("可於用餐前 2 小時前自行取消");
  await expect(notes).toContainText("超過取消時限請來電 02-0000-0000");
  await expect(page.getByRole("link", { name: "重新選擇時段" })).toHaveAttribute("href", `/?seats=3&date=${date}`);

  await confirmButton(page).click();
  await expect(page).toHaveURL(/\/me\?confirmed=\d+$/);
  await expect(page.getByRole("status")).toHaveText("訂位成功");
  await expect(page.getByText("目前沒有有效的保留")).toBeVisible();
  const booking = page.getByRole("region", { name: "我的訂位" }).getByRole("article", { name: /大廳用餐/ });
  await expect(booking).toContainText("已訂位");

  await booking.getByRole("button", { name: "取消訂位" }).click();
  await expect(page.getByRole("status")).toHaveText("已取消訂位");
  await expect(page.getByText("目前沒有訂位")).toBeVisible();
});

test("首頁訂位須知：列出各資源的說明與取消規則（seed）", async ({ page }) => {
  await page.goto("/");
  const notes = page.getByRole("region", { name: "訂位須知" });
  await expect(notes.getByText("面向開放廚房的長桌與雙人座")).toBeVisible();
  await expect(notes.getByText("可於用餐前 2 小時前自行取消")).toBeVisible();
  await expect(notes.getByText("獨立空間，適合 6–10 位")).toBeVisible();
  await expect(notes.getByText("可於用餐前 24 小時前自行取消")).toBeVisible();
});

test("選人數與日期後，時段依條件出現或消失", async ({ page }) => {
  // 訪客也能瀏覽；固定看明天的 seed 時段：大廳用餐 11:00 與 19:00、包廂 19:00
  const { date } = slotInfo("main");
  await page.goto("/");
  await chooseOption(page, "用餐日期", date);
  await expect(page.getByLabel("用餐人數")).toHaveValue("2");

  await expect(page.getByRole("button", { name: "11:00 大廳用餐", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "19:00 包廂", exact: true })).toBeVisible();

  // 6 位超過大廳用餐的單筆上限（4 位）：大廳的時段消失並說明原因，包廂仍在
  await chooseOption(page, "用餐人數", "6");
  await expect(page.getByRole("button", { name: /大廳用餐/ })).toHaveCount(0);
  await expect(page.getByText("大廳用餐最多 4 位，這個人數不列出它的時段。")).toBeVisible();
  await expect(page.getByRole("button", { name: "19:00 包廂", exact: true })).toBeVisible();
});
