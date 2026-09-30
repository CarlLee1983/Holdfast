import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LOGIN_RESUME_SESSION } from "../harness/constants";
import { memberSessionCookie } from "../harness/session-cookie";
import { holdButton, slotButton, slotInfo } from "../harness/slots";

/**
 * 未登入按時段 → 登入頁網址帶著選擇 → 寫入 session 模擬登入（ADR 0013）後重新打開登入頁，
 * 已登入的登入頁會導回 next → 首頁還原人數、日期並標示已選，但還沒有建立保留。
 */
async function pickThenLogIn(page: Page, context: BrowserContext): Promise<void> {
  const { date } = slotInfo("login-resume");
  await page.goto(`/?seats=3&date=${date}`);
  await slotButton(page, "login-resume").click();

  await expect(page).toHaveURL(/\/login\?next=/);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toMatch(new RegExp(`^/\\?seats=3&date=${date}&slot=\\d+$`));

  await context.addCookies([memberSessionCookie(LOGIN_RESUME_SESSION)]);
  await page.reload();
  await expect(page).toHaveURL((url) => url.pathname + url.search === next);
}

async function expectRestoredWithoutHold(page: Page): Promise<void> {
  const { date, time } = slotInfo("login-resume");
  await expect(page.getByLabel("用餐人數")).toHaveValue("3");
  await expect(page.getByLabel("用餐日期")).toHaveValue(date);
  await expect(slotButton(page, "login-resume")).toHaveAttribute("aria-pressed", "true");
  const summary = page.getByRole("group", { name: "目前的選擇" });
  await expect(summary).toContainText("3 位");
  await expect(summary).toContainText(`${time} 包廂`);
  await expect(holdButton(page)).toBeEnabled();

  // GET 不產生狀態：要再按一次主按鈕才會建立保留
  await page.goto("/me");
  await expect(page.getByText("目前沒有有效的保留")).toBeVisible();
}

test("未登入按時段：登入後回到首頁，選擇還在但尚未保留", async ({ page, context }) => {
  await pickThenLogIn(page, context);
  await expectRestoredWithoutHold(page);
});

test.describe("沒有 JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("未登入按時段：同樣導到登入頁，登入後選擇還在但尚未保留", async ({ page, context }) => {
    await pickThenLogIn(page, context);
    await expectRestoredWithoutHold(page);
  });
});

test("未登入但時段參數無效：不導向登入，也不標示任何時段", async ({ page }) => {
  const { date } = slotInfo("login-resume");
  await page.goto(`/?seats=3&date=${date}&slot=99999999`);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("button", { name: "請選擇用餐時段" })).toBeDisabled();
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(0);
});
