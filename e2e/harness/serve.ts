/**
 * E2E 的受測伺服器（Playwright 的 webServer 啟動它）：
 * 重建 E2E 專用的狀態 → 建置 Web → 套用 migration 與 seed → 寫入測試會員的 session（含一個專供登出測試的，以及倒數、防重複送出、無 JS、確認頁別人的保留測試各自專用的會員） → 以 `wrangler dev` 跑兩個 Worker。
 *
 * 不碰開發者的本機狀態：D1 放在 `.wrangler/e2e/state`；Web 建置到 `.wrangler/e2e/web`（不覆寫 `apps/web/dist`）；
 * 兩個 Worker 的設定檔旁都放 E2E 自己的 `.dev.vars`（wrangler 只讀設定檔旁的 `.dev.vars`，
 * `--env-file` 只套用到第一個 Worker；Astro 建置會把 `apps/web/.dev.vars` 複製到輸出目錄，所以建置後覆寫）。
 * 產生的設定檔只改路徑與 `BETTER_AUTH_URL`，其餘沿用 `apps/app/wrangler.jsonc` 的頂層設定——
 * App 的程式碼與設定都不為 E2E 修改（ADR 0013）。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { experimental_readRawConfig } from "wrangler";
import { AUTH_SECRET, BASE_URL, COUNTDOWN_MEMBER, COUNTDOWN_SESSION, DOUBLE_SUBMIT_MEMBER, DOUBLE_SUBMIT_SESSION, HOLD_OWNER_MEMBER, HOLD_OWNER_SESSION, LOGIN_RESUME_MEMBER, LOGIN_RESUME_SESSION, MEMBER, NO_JS_MEMBER, NO_JS_SESSION, PORT, SESSION, SIGN_OUT_SESSION } from "./constants";

const ROOT = resolve(import.meta.dirname, "../..");
const APP_DIR = join(ROOT, "apps/app");
const WEB_DIR = join(ROOT, "apps/web");
const E2E_DIR = join(ROOT, ".wrangler/e2e");
const STATE_DIR = join(E2E_DIR, "state");
const APP_CONFIG = join(E2E_DIR, "app/wrangler.json");
const WEB_OUT = join(E2E_DIR, "web");
const DAY_MS = 86_400_000;

function run(cmd: string[], cwd: string): void {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`E2E 準備失敗（exit ${result.exitCode}）：${cmd.join(" ")}`);
}

/** App 的 E2E 設定：頂層設定（不含 preview／production 環境），路徑改成絕對路徑。 */
function writeAppConfig(): void {
  const { rawConfig } = experimental_readRawConfig({ config: join(APP_DIR, "wrangler.jsonc") });
  const { env: _environments, $schema: _schema, ...topLevel } = rawConfig as Record<string, unknown> & {
    main?: string;
    vars?: Record<string, string>;
    d1_databases?: { migrations_dir: string }[];
  };
  if (!topLevel.main || !topLevel.d1_databases) {
    throw new Error("apps/app/wrangler.jsonc 缺少 main 或 d1_databases，無法產生 E2E 設定");
  }
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

/** 測試會員與 session 直接寫入 D1，取代社群登入（ADR 0013）。值都是 constants.ts 的常數（不含單引號），直接內插。 */
function insertMemberSession(): void {
  const now = Date.now();
  const members = [
    { member: MEMBER, sessions: [SESSION, SIGN_OUT_SESSION] },
    { member: COUNTDOWN_MEMBER, sessions: [COUNTDOWN_SESSION] },
    { member: DOUBLE_SUBMIT_MEMBER, sessions: [DOUBLE_SUBMIT_SESSION] },
    { member: NO_JS_MEMBER, sessions: [NO_JS_SESSION] },
    { member: HOLD_OWNER_MEMBER, sessions: [HOLD_OWNER_SESSION] },
    { member: LOGIN_RESUME_MEMBER, sessions: [LOGIN_RESUME_SESSION] },
  ];
  const sql = members
    .map(
      ({ member, sessions }) => `
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
      VALUES ('${member.id}', '${member.name}', '${member.email}', 0, ${now}, ${now});
    ${sessions
      .map(
        (session) => `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
      VALUES ('${session.id}', ${now + DAY_MS}, '${session.token}', ${now}, ${now}, '${member.id}');`,
      )
      .join("\n    ")}`,
    )
    .join("\n");
  d1(["execute"], ["--command", sql]);
}

rmSync(E2E_DIR, { recursive: true, force: true });
writeAppConfig();
run(["bunx", "astro", "build", "--outDir", WEB_OUT], WEB_DIR);
writeFileSync(join(WEB_OUT, "server/.dev.vars"), "");
d1(["migrations", "apply"]);
d1(["execute"], ["--file", join(APP_DIR, "seed/seed.sql")]);
insertMemberSession();

const server = Bun.spawn(
  [
    "bunx", "wrangler", "dev",
    "-c", join(WEB_OUT, "server/wrangler.json"),
    "-c", APP_CONFIG,
    "--persist-to", STATE_DIR,
    "--port", String(PORT),
    "--show-interactive-dev-session=false",
  ],
  { cwd: WEB_DIR, stdout: "inherit", stderr: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.kill(signal));
// 被訊號終止時 exitCode 不是 0，照實回報，不讓 Playwright 當成正常結束
const exitCode = await server.exited;
process.exit(exitCode === 0 ? 0 : exitCode || 1);
