import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { DOUBLE_SUBMIT_SESSION, NO_JS_SESSION } from "../harness/constants";
import { holdableSlot } from "../harness/slots";
import { memberSessionCookie } from "../harness/session-cookie";

// 專用會員（見 constants.ts）。會員同時最多 3 筆有效保留、同一時段最多一筆，
// 這位會員會建立保留的測試有 2 則（送出保留、確認後到期），各用 harness/slots.ts 裡不同資源的時段，
// 遠低於 3 筆上限；/me 上以資源名稱區分兩筆保留。無 JS 那則用另一位會員。
// 不建立保留的測試不佔額度。各測試不依賴彼此的順序或殘留狀態。
test.beforeEach(async ({ context }) => {
  await context.addCookies([memberSessionCookie(DOUBLE_SUBMIT_SESSION)]);
});

const isHoldPost = (url: URL) => url.pathname === "/";

/** 攔下首頁的 POST 並 hold 住，直到呼叫 release 才放行（或 abort）；GET 照常通過。 */
async function delayHoldPost(page: Page) {
  let release!: (action: "continue" | "abort") => void;
  const released = new Promise<"continue" | "abort">((resolve) => (release = resolve));
  let intercepted!: () => void;
  const interceptedPromise = new Promise<void>((resolve) => (intercepted = resolve));
  await page.route(isHoldPost, async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    intercepted();
    if ((await released) === "abort") return route.abort();
    return route.continue();
  });
  return { release, intercepted: interceptedPromise };
}

/**
 * 請求被 hold 住時導覽尚未完成，所以送出的 click 要加 noWaitAfter，否則 click 會一直等到導覽結束。
 * 而且導覽被 hold 住期間，Playwright 的 evaluate／expect(locator) 會一直等到導覽結束，讀不到按鈕狀態。
 * 所以改由頁面內的監聽在 submit 之後（下一個 task）主動回報按鈕是否 disabled。
 */
async function watchDisabledAfterSubmit(page: Page, button: Locator) {
  const states: boolean[] = [];
  await page.exposeFunction("reportDisabled", (disabled: boolean) => states.push(disabled));
  await button.evaluate((element: HTMLButtonElement) => {
    document.addEventListener("submit", () => {
      setTimeout(() => (window as unknown as { reportDisabled(d: boolean): void }).reportDisabled(element.disabled));
    });
  });
  return states;
}

test("送出保留後按鈕立即停用，放行後流程照常完成", async ({ page }) => {
  await page.goto("/");
  const holdButton = holdableSlot(page, "double-submit").getByRole("button", { name: "保留" });
  const gate = await delayHoldPost(page);
  const disabledStates = await watchDisabledAfterSubmit(page, holdButton);

  await holdButton.click({ noWaitAfter: true });
  await gate.intercepted;
  await expect.poll(() => disabledStates).toEqual([true]);

  gate.release("continue");
  await page.waitForURL(/\/me\?held=\d+$/);
  await expect(page.getByRole("status")).toContainText("保留成功");
});

test("原生驗證失敗（名額超出上限）不送出，按鈕維持可按", async ({ page }) => {
  await page.goto("/");
  const card = holdableSlot(page, "double-submit");
  const holdButton = card.getByRole("button", { name: "保留" });
  let posted = false;
  await page.route(isHoldPost, (route) => {
    if (route.request().method() === "POST") posted = true;
    return route.continue();
  });

  await card.getByLabel("名額").fill("999");
  await holdButton.click();

  await expect(holdButton).toBeEnabled();
  expect(posted).toBe(false);
});

test("伺服器拒絕並重新渲染頁面後，保留按鈕恢復可按", async ({ page }) => {
  await page.goto("/");
  const card = holdableSlot(page, "double-submit-rejected");
  // 移除用戶端的 max 上限，讓過大的名額能送到伺服器被拒絕（不需要任何測試專用開關）
  await card.getByLabel("名額").evaluate((input: HTMLInputElement) => {
    input.removeAttribute("max");
    input.value = "999";
  });

  const response = page.waitForResponse((r) => isHoldPost(new URL(r.url())) && r.request().method() === "POST");
  await card.getByRole("button", { name: "保留" }).click();
  expect((await response).status()).toBe(409);

  // 確認是名額超過單筆上限造成的拒絕，而不是其他錯誤
  await expect(page.getByRole("alert")).toHaveText("超過這個資源的單筆名額上限");
  await expect(holdableSlot(page, "double-submit-rejected").getByRole("button", { name: "保留" })).toBeEnabled();
});

test("從 bfcache 還原時只恢復自己停用的按鈕", async ({ page }) => {
  await page.goto("/");
  const holdButton = holdableSlot(page, "double-submit").getByRole("button", { name: "保留" });
  // 在共用 script 之後（同在 document、註冊較晚）攔下送出，讓頁面停留在原地、保留被停用的按鈕，
  // 模擬「送出後離開、再從 bfcache 返回」時 DOM 仍是停用狀態
  await page.evaluate(() => document.addEventListener("submit", (event) => event.preventDefault()));

  await holdButton.click();
  await expect(holdButton).toBeDisabled();

  // Playwright 無法穩定觸發真正的 bfcache，改以合成的 pageshow(persisted: false) 與 pageshow(persisted: true) 驗證處理器
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  await expect(holdButton).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(holdButton).toBeEnabled();
});

test("送出確認後才到期：pageshow 還原不會把已到期的確認按鈕恢復可按", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await holdableSlot(page, "double-submit-confirm").getByRole("button", { name: "保留" }).click();
  await expect(page).toHaveURL(/\/me\?held=\d+$/);

  // 同一位會員在「大廳用餐」還可能有另一則測試留下的保留，用資源名稱鎖定本則的「包廂」保留
  const confirm = page
    .getByRole("region", { name: "我的保留" })
    .getByRole("article", { name: /包廂/ })
    .getByRole("button", { name: "確認訂位" });
  await expect(confirm).toBeEnabled();
  // 在共用 script 之後攔下送出，讓頁面停留在原地：按鈕帶著 data-submitting，模擬「已送出、伺服器尚未回應」
  await page.evaluate(() => document.addEventListener("submit", (event) => event.preventDefault()));
  await confirm.click();
  await expect(confirm).toHaveAttribute("data-submitting", "");

  // 回應前倒數歸零：按鈕同時帶有 data-submitting 與 data-expired
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(confirm).toHaveAttribute("data-expired", "");
  await expect(confirm).toBeDisabled();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(confirm).toBeDisabled();
  await expect(confirm).not.toHaveAttribute("data-submitting");
});

test.describe("沒有 JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  // 外層 beforeEach 先加入 double-submit 會員的 cookie，這裡再加入同名的 cookie 覆蓋成無 JS 專用會員
  test.beforeEach(async ({ context }) => {
    await context.addCookies([memberSessionCookie(NO_JS_SESSION)]);
  });

  test("保留表單照常送出，導向 /me?held= 並看到保留卡片", async ({ page }) => {
    await page.goto("/");
    await holdableSlot(page, "no-js").getByRole("button", { name: "保留" }).click();

    await expect(page).toHaveURL(/\/me\?held=\d+$/);
    await expect(page.getByRole("status")).toContainText("保留成功");
    await expect(page.getByRole("region", { name: "我的保留" }).getByRole("article", { name: /包廂/ })).toHaveCount(1);
  });
});
