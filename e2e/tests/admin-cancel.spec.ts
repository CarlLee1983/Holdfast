import { expect, test } from "@playwright/test";
import { adminAccessHeaders } from "../harness/admin-access";
import { ADMIN_CANCEL_MEMBER, ADMIN_CANCEL_SESSION, BASE_URL } from "../harness/constants";
import { memberSessionCookie } from "../harness/session-cookie";
import { confirmButton, pickSlot, slotInfo } from "../harness/slots";

test("管理者在日程表取消會員訂位並填原因 → 會員頁看到店家已取消與原因", async ({ browser }) => {
  const reason = "店休臨時調整，造成不便敬請見諒";

  // 會員先透過 UI 建立並確認訂位
  const memberContext = await browser.newContext();
  await memberContext.addCookies([memberSessionCookie(ADMIN_CANCEL_SESSION)]);
  const memberPage = await memberContext.newPage();
  await (await pickSlot(memberPage, "admin-cancel")).click();
  await expect(memberPage).toHaveURL(/\/holds\/\d+$/);
  await confirmButton(memberPage).click();
  await expect(memberPage).toHaveURL(/\/bookings\/\d+$/);

  // 管理者用獨立 context，帶 Access JWT header（與 production 的 Cloudflare Access 相同）
  const adminContext = await browser.newContext({ baseURL: BASE_URL, extraHTTPHeaders: adminAccessHeaders() });
  const adminPage = await adminContext.newPage();
  const { date, time, resource } = slotInfo("admin-cancel");
  await adminPage.goto(`/admin?date=${date}`);
  // 先證明 header 有被接受：金鑰設定壞掉時，這裡會是 403 畫面而不是日程表
  await expect(adminPage.getByRole("navigation", { name: "切換日期" })).toBeVisible();

  // 同一時段可能還有其他 spec 的會員，用會員名稱鎖定這一列
  const slotItem = adminPage.locator("li.agenda-slot").filter({ hasText: time }).filter({ hasText: resource });
  const row = slotItem.locator("ul.agenda-people > li").filter({ hasText: ADMIN_CANCEL_MEMBER.name });
  await row.getByLabel("取消原因（選填，會員看得到）").fill(reason);
  await row.getByRole("button", { name: "取消訂位" }).click();
  await expect(adminPage.getByRole("status")).toContainText("訂位已取消，名額已歸還。");

  // 會員頁看到店家取消與原因
  await memberPage.goto("/me");
  const booking = memberPage.getByRole("region", { name: "我的訂位" }).getByRole("article", { name: /大廳用餐/ });
  await expect(booking).toContainText("店家已取消");
  await expect(booking).toContainText(`取消原因：${reason}`);

  await adminContext.close();
  await memberContext.close();
});
