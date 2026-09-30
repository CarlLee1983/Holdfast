import { describe, expect, it } from "vitest";
import { findResourceBySlotId } from "./find-resource";

const catalog = [
  { resource: { name: "大廳用餐" }, slots: [{ id: 1 }, { id: 2 }] },
  { resource: { name: "包廂" }, slots: [{ id: 3 }] },
];

describe("findResourceBySlotId", () => {
  it("回傳時段所屬的資源", () => {
    expect(findResourceBySlotId(catalog, 2)).toEqual({ name: "大廳用餐" });
    expect(findResourceBySlotId(catalog, 3)).toEqual({ name: "包廂" });
  });

  it("找不到時段時回傳 null", () => {
    expect(findResourceBySlotId(catalog, 99)).toBeNull();
    expect(findResourceBySlotId([], 1)).toBeNull();
  });
});
