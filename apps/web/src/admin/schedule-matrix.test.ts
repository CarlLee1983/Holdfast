import { describe, expect, it } from "vitest";
import { groupScheduleByResourceAndDay } from "./schedule-matrix";
import type { AgendaSlotLike } from "./agenda-matrix";
import type { WeekDayInfo } from "./schedule-date";

describe("groupScheduleByResourceAndDay", () => {
  const resources = [
    { id: 1, name: "大廳用餐", retiredAt: null },
    { id: 2, name: "包廂 A", retiredAt: null },
  ];

  const weekDays: WeekDayInfo[] = [
    { dateKey: "2026-09-28", dayOfWeek: 1, label: "週一 (09/28)" },
    { dateKey: "2026-09-29", dayOfWeek: 2, label: "週二 (09/29)" },
    { dateKey: "2026-09-30", dayOfWeek: 3, label: "週三 (09/30)" },
    { dateKey: "2026-10-01", dayOfWeek: 4, label: "週四 (10/01)" },
    { dateKey: "2026-10-02", dayOfWeek: 5, label: "週五 (10/02)" },
    { dateKey: "2026-10-03", dayOfWeek: 6, label: "週六 (10/03)" },
    { dateKey: "2026-10-04", dayOfWeek: 7, label: "週日 (10/04)" },
  ];

  // 2026-09-28 12:00:00 台北時間 = 1790568000000 UTC
  // 1790568000000 - 8*3600*1000 = 1790539200000 UTC ms
  const slotMonday: AgendaSlotLike = {
    id: 101,
    resourceId: 1,
    resourceName: "大廳用餐",
    resourceRetiredAt: null,
    // 2026-09-28 12:00 Taipei (UTC 04:00)
    startsAt: Date.UTC(2026, 8, 28, 4, 0, 0),
    endsAt: Date.UTC(2026, 8, 28, 5, 30, 0),
    capacity: 20,
    occupied: 5,
    remainingSeats: 15,
    overcommitted: false,
    bookings: [],
    holds: [],
    cancelledBookings: [],
  };

  const slotWednesday: AgendaSlotLike = {
    id: 102,
    resourceId: 1,
    resourceName: "大廳用餐",
    resourceRetiredAt: null,
    // 2026-09-30 18:00 Taipei (UTC 10:00)
    startsAt: Date.UTC(2026, 8, 30, 10, 0, 0),
    endsAt: Date.UTC(2026, 8, 30, 12, 0, 0),
    capacity: 20,
    occupied: 20,
    remainingSeats: 0,
    overcommitted: false,
    bookings: [],
    holds: [],
    cancelledBookings: [],
  };

  it("將時段依照資源與 7 天日期精確歸位", () => {
    const matrix = groupScheduleByResourceAndDay([slotWednesday, slotMonday], resources, weekDays);

    expect(matrix).toHaveLength(2);
    // 第一個資源：大廳用餐
    const hallRow = matrix[0]!;
    expect(hallRow.resource.id).toBe(1);
    expect(hallRow.days).toHaveLength(7);

    // 週一有 slotMonday
    expect(hallRow.days[0]!.slots).toHaveLength(1);
    expect(hallRow.days[0]!.slots[0]!.id).toBe(101);

    // 週二為空
    expect(hallRow.days[1]!.slots).toHaveLength(0);

    // 週三有 slotWednesday
    expect(hallRow.days[2]!.slots).toHaveLength(1);
    expect(hallRow.days[2]!.slots[0]!.id).toBe(102);

    // 第二個資源：包廂 A，全週為空
    const roomRow = matrix[1]!;
    expect(roomRow.resource.id).toBe(2);
    expect(roomRow.days.every((d) => d.slots.length === 0)).toBe(true);
  });
});
