import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { memberSessionCookie } from "../harness/session-cookie";
import { confirmButton } from "../harness/slots";

const ROOT = resolve(import.meta.dirname, "../..");

function d1(sql: string): { results: { id: number }[] }[] {
  const output = execFileSync("bunx", [
    "wrangler", "d1", "execute", "holdfast", "--local",
    "--config", resolve(ROOT, ".wrangler/e2e/app/wrangler.json"),
    "--persist-to", resolve(ROOT, ".wrangler/e2e/state"),
    "--command", sql, "--json",
  ], { cwd: ROOT, encoding: "utf8" });
  return JSON.parse(output) as { results: { id: number }[] }[];
}

test("停用資源後，自己的有效保留仍可確認", async ({ page, context }) => {
  const key = randomUUID();
  const memberId = `retire-member-${key}`;
  const token = `retire-session-${key}`;
  const name = "停用測試";
  const now = Date.now();
  const startsAt = now + 86_400_000;
  const endsAt = startsAt + 3_600_000;
  const rows = d1(`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${memberId}', '停用測試會員', '${key}@members.holdfast.invalid', 0, ${now}, ${now});
    INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
      VALUES ('${token}', ${now + 86_400_000}, '${token}', ${now}, ${now}, '${memberId}');
    INSERT INTO resources (name, hold_ttl_seconds, seats_per_hold, cancellation_cutoff_seconds, description)
      VALUES ('${name}', 600, 4, 3600, '停用後仍應顯示');
    INSERT INTO slots (resource_id, starts_at, ends_at, capacity)
      SELECT id, ${startsAt}, ${endsAt}, 10 FROM resources WHERE name = '${name}';
    INSERT INTO holds (slot_id, member_id, seats, status, expires_at, idempotency_key, created_at)
      SELECT s.id, '${memberId}', 2, 'held', ${now + 600_000}, '${key}', ${now}
      FROM slots s JOIN resources r ON r.id = s.resource_id WHERE r.name = '${name}';
    SELECT id FROM holds WHERE idempotency_key = '${key}';
  `);
  const holdId = rows.at(-1)?.results[0]?.id;
  expect(holdId).toBeDefined();
  await context.addCookies([memberSessionCookie({ token })]);

  const holdPath = `/holds/${holdId}`;
  expect((await page.goto(holdPath))?.status()).toBe(200);
  await expect(page.getByRole("main")).toContainText(name);
  await expect(page.getByRole("main")).toContainText("停用後仍應顯示");

  d1(`UPDATE resources SET retired_at = ${Date.now()} WHERE name = '${name}';`);
  expect((await page.reload())?.status()).toBe(200);
  await expect(confirmButton(page)).toBeVisible();
  await expect(page.getByRole("main")).toContainText(name);
  await page.goto("/");
  await expect(page.getByRole("main")).not.toContainText(name);

  await page.goto(holdPath);
  await confirmButton(page).click();
  await expect(page).toHaveURL(/\/bookings\/\d+$/);
  await expect(page.getByRole("main")).toContainText(name);
  await page.goto("/me");
  await expect(page.getByRole("region", { name: "我的訂位" })).toContainText(name);
});
