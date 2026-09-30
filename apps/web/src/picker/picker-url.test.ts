import { describe, expect, it } from "vitest";
import { safeNextPath } from "../auth/member";
import { pickerLoginUrl, pickerPath } from "./picker-url";

describe("pickerPath", () => {
  it("首頁網址帶上人數、日期與時段", () => {
    expect(pickerPath({ seats: 3, date: "2026-10-01", slot: 42 })).toBe("/?seats=3&date=2026-10-01&slot=42");
  });

  it("沒有時段時只帶人數與日期", () => {
    expect(pickerPath({ seats: 3, date: "2026-10-01" })).toBe("/?seats=3&date=2026-10-01");
  });
});

describe("pickerLoginUrl", () => {
  const selection = { seats: 3, date: "2026-10-01", slot: 42 };

  it("導到登入頁，next 是整段編碼後的首頁網址", () => {
    expect(pickerLoginUrl(selection)).toBe("/login?next=%2F%3Fseats%3D3%26date%3D2026-10-01%26slot%3D42");
  });

  it("登入頁解出的 next 是站內路徑，而且與原本的選擇相同", () => {
    const next = new URL(pickerLoginUrl(selection), "https://holdfast.example").searchParams.get("next");
    expect(safeNextPath(next)).toBe(pickerPath(selection));
  });
});
