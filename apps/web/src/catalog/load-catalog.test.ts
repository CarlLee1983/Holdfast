import { describe, expect, it } from "vitest";
import { loadCatalog } from "./load-catalog";

type AppRpc = Parameters<typeof loadCatalog>[0];

// 只實作 loadCatalog 會用到的兩個 RPC 方法
const fakeApp = (impl: {
  listResources: () => Promise<unknown>;
  listSlots: (resourceId: number) => Promise<unknown>;
}) => impl as unknown as AppRpc;

const resource = {
  id: 1,
  name: "大廳",
  holdTtlSeconds: 600,
  seatsPerHold: 4,
  cancellationCutoffSeconds: 3600,
};
const slot = { id: 7, startsAt: 1, endsAt: 2, capacity: 20, remainingSeats: 20 };

describe("loadCatalog", () => {
  it("把每個資源與它的時段組在一起", async () => {
    const app = fakeApp({
      listResources: async () => ({ ok: true, data: [resource] }),
      listSlots: async () => ({ ok: true, data: [slot] }),
    });

    expect(await loadCatalog(app)).toEqual([{ resource, slots: [slot] }]);
  });

  it("listResources 失敗時丟出錯誤，不當作空列表", async () => {
    const app = fakeApp({
      listResources: async () => ({ ok: false, reason: "boom" }),
      listSlots: async () => ({ ok: true, data: [] }),
    });

    await expect(loadCatalog(app)).rejects.toThrow("boom");
  });

  it("listSlots 失敗時丟出錯誤，不當作沒有時段", async () => {
    const app = fakeApp({
      listResources: async () => ({ ok: true, data: [resource] }),
      listSlots: async () => ({ ok: false, reason: "resource_not_found" }),
    });

    await expect(loadCatalog(app)).rejects.toThrow("resource_not_found");
  });
});
