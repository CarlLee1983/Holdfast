import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./harness/constants";

export default defineConfig({
  testDir: "tests",
  forbidOnly: !!process.env.CI,
  // 主流程只有一條，重試只會掩蓋接線問題
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 每次重建 E2E 專用的狀態後，以建置產物跑 Web 與 App 兩個 Worker（見 harness/serve.ts）
    command: "bun harness/serve.ts",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
  },
});
