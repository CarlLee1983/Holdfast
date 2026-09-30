import { expect, test, type Browser } from "@playwright/test";
import { HOLD_OWNER_SESSION } from "../harness/constants";
import { memberSessionCookie } from "../harness/session-cookie";
import { confirmButton, pickSlot } from "../harness/slots";

const UNAVAILABLE = "此保留已過期或不存在";

test("未登入打開確認頁：導到登入頁，next 是確認頁", async ({ page }) => {
  await page.goto("/holds/1");
  await expect(page).toHaveURL(/\/login\?next=%2Fholds%2F1$/);
});

test.describe("已登入", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([memberSessionCookie()]);
  });

  test("不存在的保留：404，顯示統一的畫面與重新選擇時段", async ({ page }) => {
    const response = await page.goto("/holds/99999999");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
    await expect(page.getByRole("link", { name: "重新選擇時段" })).toHaveAttribute("href", "/");
    await expect(confirmButton(page)).toHaveCount(0);
  });

  test("網址不是正整數：同樣顯示統一的畫面", async ({ page }) => {
    const response = await page.goto("/holds/abc");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
  });

  test("別人的保留：與不存在時同一個畫面，不洩漏保留是否存在", async ({ page, browser }) => {
    // 保留擁有者用獨立的 context（另一位會員的 cookie），建立一筆保留後記下網址
    const ownerContext = await browser.newContext();
    await ownerContext.addCookies([memberSessionCookie(HOLD_OWNER_SESSION)]);
    const ownerPage = await ownerContext.newPage();
    await (await pickSlot(ownerPage, "main")).click();
    await expect(ownerPage).toHaveURL(/\/holds\/\d+$/);
    const holdPath = new URL(ownerPage.url()).pathname;
    // 擁有者自己看得到確認按鈕，確認這個網址對別人才是「不存在」
    await expect(confirmButton(ownerPage)).toBeVisible();
    await ownerContext.close();

    const response = await page.goto(holdPath);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
    await expect(confirmButton(page)).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("大廳用餐");
  });
});

const NOT_FOUND = "找不到這筆訂位";

/** 保留擁有者（獨立 context）在指定時段建立保留並確認，回傳確認頁與完成頁的路徑，之後關閉 context。 */
async function ownerBookingPaths(browser: Browser, role: "booking-owner" | "booking-owner-redirect") {
  const ownerContext = await browser.newContext();
  await ownerContext.addCookies([memberSessionCookie(HOLD_OWNER_SESSION)]);
  const ownerPage = await ownerContext.newPage();
  await (await pickSlot(ownerPage, role)).click();
  await expect(ownerPage).toHaveURL(/\/holds\/\d+$/);
  const holdPath = new URL(ownerPage.url()).pathname;
  await confirmButton(ownerPage).click();
  await expect(ownerPage).toHaveURL(/\/bookings\/\d+$/);
  const bookingPath = new URL(ownerPage.url()).pathname;
  await ownerContext.close();
  return { holdPath, bookingPath };
}

test("未登入打開完成頁：導到登入頁，next 是完成頁", async ({ page }) => {
  await page.goto("/bookings/1");
  await expect(page).toHaveURL(/\/login\?next=%2Fbookings%2F1$/);
});

test.describe("完成頁（已登入）", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([memberSessionCookie()]);
  });

  test("不存在的訂位：404，顯示找不到與查看我的保留與訂位", async ({ page }) => {
    const response = await page.goto("/bookings/99999999");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
    await expect(page.getByRole("link", { name: "查看我的保留與訂位" })).toHaveAttribute("href", "/me");
  });

  test("別人的訂位：與不存在時同一個畫面，不洩漏訂位內容", async ({ page, browser }) => {
    const { bookingPath } = await ownerBookingPaths(browser, "booking-owner");

    const response = await page.goto(bookingPath);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("包廂");
  });

  test("已確認的保留網址：對本人 303 到完成頁", async ({ browser }) => {
    // 這則要以擁有者本人打開，所以自己開 context，不用外層 MEMBER 的 page
    const { holdPath, bookingPath } = await ownerBookingPaths(browser, "booking-owner-redirect");
    const ownerContext = await browser.newContext();
    await ownerContext.addCookies([memberSessionCookie(HOLD_OWNER_SESSION)]);
    const page = await ownerContext.newPage();

    await page.goto(holdPath);
    await expect(page).toHaveURL(bookingPath);
    await expect(page.getByRole("heading", { level: 1, name: "訂位完成" })).toBeVisible();
    await ownerContext.close();
  });
});
