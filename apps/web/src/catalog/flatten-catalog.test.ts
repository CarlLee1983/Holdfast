import { describe, expect, it } from "vitest";
import { flattenCatalog } from "./flatten-catalog";

describe("flattenCatalog", () => {
  it("每個時段帶上所屬資源的名稱與單筆名額上限", () => {
    const flat = flattenCatalog([
      { resource: { name: "大廳用餐", seatsPerHold: 4 }, slots: [{ id: 1 }, { id: 2 }] },
      { resource: { name: "包廂", seatsPerHold: 8 }, slots: [] },
      { resource: { name: "課程", seatsPerHold: 1 }, slots: [{ id: 3 }] },
    ]);
    expect(flat).toEqual([
      { id: 1, resourceName: "大廳用餐", seatsPerHold: 4 },
      { id: 2, resourceName: "大廳用餐", seatsPerHold: 4 },
      { id: 3, resourceName: "課程", seatsPerHold: 1 },
    ]);
  });

  it("空目錄回傳空陣列", () => {
    expect(flattenCatalog([])).toEqual([]);
  });
});
