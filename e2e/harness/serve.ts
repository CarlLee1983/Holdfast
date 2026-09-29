/**
 * E2E 的受測伺服器（Playwright 的 webServer 啟動它）：
 * 重建 E2E 專用的狀態 → 建置 Web → 套用 migration 與 seed → 寫入測試會員的 session → 以 `wrangler dev` 跑兩個 Worker。
 *
 * 不碰開發者的本機狀態：D1 放在 `.wrangler/e2e/state`；App 用產生出來的設定檔，
 * 旁邊放 E2E 自己的 `.dev.vars`（wrangler 只讀設定檔旁的 `.dev.vars`，`--env-file` 只套用到第一個 Worker）。
 * 產生的設定檔只改路徑與 `BETTER_AUTH_URL`，其餘沿用 `apps/app/wrangler.jsonc` 的頂層設定——
 * App 的程式碼與設定都不為 E2E 修改（ADR 0013）。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { experimental_readRawConfig } from "wrangler";
import { AUTH_SECRET, BASE_URL, MEMBER, PORT, SESSION_TOKEN } from "./constants";

const ROOT = resolve(import.meta.dirname, "../..");
const APP_DIR = join(ROOT, "apps/app");
const WEB_DIR = join(ROOT, "apps/web");
const E2E_DIR = join(ROOT, ".wrangler/e2e");
const STATE_DIR = join(E2E_DIR, "state");
const APP_CONFIG = join(E2E_DIR, "app/wrangler.json");
const DAY_MS = 86_400_000;

function run(cmd: string[], cwd: string): void {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`E2E 準備失敗（exit ${result.exitCode}）：${cmd.join(" ")}`);
}

/** App 的 E2E 設定：頂層設定（不含 preview／production 環境），路徑改成絕對路徑。 */
function writeAppConfig(): void {
  const { rawConfig } = experimental_readRawConfig({ config: join(APP_DIR, "wrangler.jsonc") });
  const { env: _environments, $schema: _schema, ...topLevel } = rawConfig as Record<string, unknown> & {
    main: string;
    vars: Record<string, string>;
    d1_databases: { migrations_dir: string }[];
  };
  const config = {
    ...topLevel,
    main: join(APP_DIR, topLevel.main),
    vars: { ...topLevel.vars, BETTER_AUTH_URL: BASE_URL },
    d1_databases: topLevel.d1_databases.map((db) => ({ ...db, migrations_dir: join(APP_DIR, db.migrations_dir) })),
  };
  mkdirSync(join(E2E_DIR, "app"), { recursive: true });
  writeFileSync(APP_CONFIG, JSON.stringify(config, null, 2));
  // OAuth 的值只需非空：E2E 不走 OAuth，但缺少時 App 會把整個會員登入判為不可用
  writeFileSync(
    join(E2E_DIR, "app/.dev.vars"),
    [
      `BETTER_AUTH_SECRET=${AUTH_SECRET}`,
      "GOOGLE_CLIENT_ID=e2e",
      "GOOGLE_CLIENT_SECRET=e2e",
      "LINE_CHANNEL_ID=e2e",
      "LINE_CHANNEL_SECRET=e2e",
    ].join("\n"),
  );
}

/** 對 E2E 的本機 D1 執行 `wrangler d1 <command> holdfast ...`。 */
function d1(command: string[], options: string[] = []): void {
  run(["bunx", "wrangler", "d1", ...command, "holdfast", "--local", "-c", APP_CONFIG, "--persist-to", STATE_DIR, ...options], APP_DIR);
}

/** 測試會員與 session 直接寫入 D1，取代社群登入（ADR 0013）。 */
function insertMemberSession(): void {
  const now = Date.now();
  const sql = `
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${MEMBER.id}', '${MEMBER.name}', '${MEMBER.email}', 0, ${now}, ${now});
    INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
      VALUES ('e2e-session', ${now + DAY_MS}, '${SESSION_TOKEN}', ${now}, ${now}, '${MEMBER.id}');`;
  d1(["execute"], ["--command", sql]);
}

rmSync(E2E_DIR, { recursive: true, force: true });
writeAppConfig();
run(["bunx", "astro", "build"], WEB_DIR);
d1(["migrations", "apply"]);
d1(["execute"], ["--file", join(APP_DIR, "seed/seed.sql")]);
insertMemberSession();

const server = Bun.spawn(
  [
    "bunx", "wrangler", "dev",
    "-c", "dist/server/wrangler.json",
    "-c", APP_CONFIG,
    "--persist-to", STATE_DIR,
    "--port", String(PORT),
    "--show-interactive-dev-session=false",
  ],
  { cwd: WEB_DIR, stdout: "inherit", stderr: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.kill(signal));
process.exit(await server.exited);
