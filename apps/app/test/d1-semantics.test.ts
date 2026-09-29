import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 特徵化測試：記錄「本機 miniflare/workerd 的 D1」實際的語意，供 docs/research/cloudflare-concurrency.md 引用。
// production D1 未實測，這裡的結果不代表 production。
// 用拋棄式資料表，不碰業務資料表。

beforeEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS d1_probe");
  await env.DB.exec("CREATE TABLE d1_probe (id INTEGER PRIMARY KEY, v TEXT NOT NULL UNIQUE)");
});

afterEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS d1_probe");
});

async function probeCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM d1_probe").first<{ n: number }>();
  return row!.n;
}

describe("本機 D1 的交易語意", () => {
  it("exec 與 prepare 執行 BEGIN TRANSACTION 都會丟出錯誤（不支援互動式交易）", async () => {
    await expect(env.DB.exec("BEGIN TRANSACTION")).rejects.toThrow(/state\.storage\.transaction\(\)/);
    await expect(env.DB.prepare("BEGIN TRANSACTION").run()).rejects.toThrow(/state\.storage\.transaction\(\)/);
  });

  it("batch() 裡有一句影響 0 列，後面的 INSERT 仍會提交（不回滾）", async () => {
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE d1_probe SET v = 'x' WHERE 0"),
      env.DB.prepare("INSERT INTO d1_probe (v) VALUES ('kept')"),
    ]);

    expect(results[0]!.meta.changes).toBe(0);
    expect(results[1]!.meta.changes).toBe(1);
    expect(await probeCount()).toBe(1);
  });

  it("batch() 裡有一句出錯就丟出例外，先前成功的 INSERT 一併回滾", async () => {
    await expect(
      env.DB.batch([
        env.DB.prepare("INSERT INTO d1_probe (v) VALUES ('rolled-back')"),
        env.DB.prepare("INSERT INTO d1_probe (v) VALUES (NULL)"),
      ]),
    ).rejects.toThrow();

    expect(await probeCount()).toBe(0);
  });
});
