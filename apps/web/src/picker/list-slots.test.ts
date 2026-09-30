import { describe, expect, it } from "vitest";
import { pickerAvailability, selectedSlot, slotsOnDate } from "./list-slots";

const utc = (iso: string) => Date.parse(iso);
const NOW = utc("2026-09-30T02:00:00Z"); // 台北 9/30 10:00

const slot = (id: number, startsAt: number, remainingSeats = 5) => ({ id, startsAt, remainingSeats });

describe("slotsOnDate", () => {
  it("只留下該台北日期的時段，別的日期不列出", () => {
    const slots = [
      slot(1, utc("2026-10-01T03:00:00Z")), // 台北 10/1 11:00
      slot(2, utc("2026-10-02T03:00:00Z")), // 10/2
      slot(3, utc("2026-09-30T16:00:00Z")), // 台北 10/1 00:00
    ];
    expect(slotsOnDate(slots, "2026-10-01", NOW).map((s) => s.id)).toEqual([1, 3]);
  });

  it("已開始的時段不列出（開始時間等於現在也算已開始）", () => {
    const slots = [slot(1, utc("2026-09-30T01:00:00Z")), slot(2, NOW), slot(3, NOW + 1)];
    expect(slotsOnDate(slots, "2026-09-30", NOW).map((s) => s.id)).toEqual([3]);
  });
});

describe("pickerAvailability", () => {
  const later = NOW + 3_600_000;

  it("剩餘名額足夠（含剛好等於人數）為可選", () => {
    expect(pickerAvailability(slot(1, later, 4), 4, NOW)).toBe("open");
    expect(pickerAvailability(slot(1, later, 5), 4, NOW)).toBe("open");
  });

  it("剩餘名額大於 0 但少於人數為「名額不足」", () => {
    expect(pickerAvailability(slot(1, later, 3), 4, NOW)).toBe("short");
    expect(pickerAvailability(slot(1, later, 1), 2, NOW)).toBe("short");
  });

  it("剩餘名額為 0 為已額滿，不論人數", () => {
    expect(pickerAvailability(slot(1, later, 0), 1, NOW)).toBe("full");
    expect(pickerAvailability(slot(1, later, 0), 4, NOW)).toBe("full");
  });

  it("已開始優先於額滿與名額不足", () => {
    expect(pickerAvailability(slot(1, NOW, 0), 2, NOW)).toBe("started");
    expect(pickerAvailability(slot(1, NOW, 1), 2, NOW)).toBe("started");
  });
});

describe("selectedSlot", () => {
  const later = NOW + 3_600_000;
  const listed = [
    slot(1, later, 5),
    slot(2, later, 0), // 已額滿
    slot(3, later, 1), // 剩 1 位
    slot(4, NOW - 1, 5), // 已開始（未經篩選的輸入）
  ];

  it("列出的、名額足夠的時段就是選中", () => {
    expect(selectedSlot(listed, "1", 2, NOW)?.id).toBe(1);
  });

  it("已額滿的時段不算選中", () => {
    expect(selectedSlot(listed, "2", 1, NOW)).toBeNull();
  });

  it("剩餘名額少於人數的時段不算選中，人數夠小時才算", () => {
    expect(selectedSlot(listed, "3", 2, NOW)).toBeNull();
    expect(selectedSlot(listed, "3", 1, NOW)?.id).toBe(3);
  });

  it("已開始的時段不算選中", () => {
    expect(selectedSlot(listed, "4", 2, NOW)).toBeNull();
  });

  it("不在清單內的編號不算選中", () => {
    expect(selectedSlot(listed, "999", 2, NOW)).toBeNull();
  });

  it("沒帶或格式不對的編號不算選中", () => {
    for (const raw of [null, "", "abc", "0", "-1"]) {
      expect(selectedSlot(listed, raw, 2, NOW)).toBeNull();
    }
  });
});
