import { expect, test } from "@playwright/test";
import { SIGN_OUT_SESSION } from "../harness/constants";
import { memberSessionCookie } from "../harness/session-cookie";

test("未登入：頁首有登入連結，沒有登出按鈕", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主要導覽" });
  await expect(nav.getByRole("link", { name: "Holdfast" })).toHaveAttribute("href", "/");
  await expect(nav.getByRole("link", { name: "登入" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "登出" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "我的保留與訂位" })).toHaveCount(0);
});

test("登入後：頁首顯示會員名稱、我的保留與訂位、登出；登出後回到未登入", async ({ page, context }) => {
  // 登出會讓 session 失效，所以用獨立的 session，不影響其他測試共用的那一個
  await context.addCookies([memberSessionCookie(SIGN_OUT_SESSION)]);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主要導覽" });
  await expect(nav.getByText("E2E 會員")).toBeVisible();
  await expect(nav.getByRole("link", { name: "我的保留與訂位" })).toHaveAttribute("href", "/me");
  await expect(nav.getByRole("link", { name: "登入" })).toHaveCount(0);

  await nav.getByRole("button", { name: "登出" }).click();
  await expect(nav.getByRole("link", { name: "登入" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "登出" })).toHaveCount(0);
});

test("其他會員頁也有共用頁首", async ({ page, context }) => {
  await page.goto("/login");
  await expect(page.getByRole("navigation", { name: "主要導覽" })).toBeVisible();
  await expect(page).toHaveTitle("登入 | Holdfast 訂位");
  await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "登入" })).toHaveCount(0);

  await context.addCookies([memberSessionCookie()]);
  for (const path of ["/me", "/account/delete"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("button", { name: "登出" })).toBeVisible();
  }
});

test("不存在的網址回 404 並顯示自訂 404 頁", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "找不到這個頁面" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "回首頁" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("navigation", { name: "主要導覽" })).toBeVisible();
});
