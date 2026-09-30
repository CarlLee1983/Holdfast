import { describe, expect, it } from "vitest";
import { groupSlotsByResource } from "./agenda-matrix";
import type { AgendaSlotLike } from "./agenda-matrix";


describe("groupSlotsByResource", () => {
  const r1 = { id: 1, name: "大廳用餐", retiredAt: null, holdTtlMinutes: 10, seatsPerHold: 4, cancellationCutoffHours: 2 };
  const r2 = { id: 2, name: "包廂 A", retiredAt: null, holdTtlMinutes: 15, seatsPerHold: 8, cancellationCutoffHours: 24 };
  const r3 = { id: 3, name: "包廂 B（已停用）", retiredAt: 1000, holdTtlMinutes: 15, seatsPerHold: 8, cancellationCutoffHours: 24 };

  const slot1: AgendaSlotLike = {
    id: 101,
    resourceId: 1,
    resourceName: "大廳用餐",
    resourceRetiredAt: null,
    startsAt: 1700000000,
    endsAt: 1700003600,
    capacity: 20,
    occupied: 5,
    remainingSeats: 15,
    overcommitted: false,
    bookings: [],
    holds: [],
    cancelledBookings: [],
  };

  const slot2: AgendaSlotLike = {
    id: 102,
    resourceId: 1,
    resourceName: "大廳用餐",
    resourceRetiredAt: null,
    startsAt: 1700007200,
    endsAt: 1700010800,
    capacity: 20,
    occupied: 20,
    remainingSeats: 0,
    overcommitted: false,
    bookings: [],
    holds: [],
    cancelledBookings: [],
  };

  const slot3: AgendaSlotLike = {
    id: 103,
    resourceId: 2,
    resourceName: "包廂 A",
    resourceRetiredAt: null,
    startsAt: 1700000000,
    endsAt: 1700007200,
    capacity: 8,
    occupied: 8,
    remainingSeats: 0,
    overcommitted: false,
    bookings: [],
    holds: [],
    cancelledBookings: [],
  };

  it("依資源分組時段，並保留所有傳入的資源，即使該資源沒有時段", () => {
    const groups = groupSlotsByResource([slot2, slot1, slot3], [r1, r2, r3]);

    expect(groups).toHaveLength(3);
    // r1: slot1, slot2 依開始時間由早到晚排序
    expect(groups[0]!.resource.id).toBe(1);
    expect(groups[0]!.slots.map((s) => s.id)).toEqual([101, 102]);

    // r2: slot3
    expect(groups[1]!.resource.id).toBe(2);
    expect(groups[1]!.slots.map((s) => s.id)).toEqual([103]);

    // r3: 沒有時段
    expect(groups[2]!.resource.id).toBe(3);
    expect(groups[2]!.slots).toEqual([]);
  });

  it("若時段所屬資源不在資源清單中（例如外部資料），自動補在清單末尾", () => {
    const unknownSlot: AgendaSlotLike = {
      id: 999,
      resourceId: 99,
      resourceName: "臨時快閃場地",
      resourceRetiredAt: null,
      startsAt: 1700000000,
      endsAt: 1700003600,
      capacity: 10,
      occupied: 0,
      remainingSeats: 10,
      overcommitted: false,
      bookings: [],
      holds: [],
      cancelledBookings: [],
    };

    const groups = groupSlotsByResource([unknownSlot], [r1]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.resource.id).toBe(1);
    expect(groups[0]!.slots).toEqual([]);
    expect(groups[1]!.resource.id).toBe(99);
    expect(groups[1]!.resource.name).toBe("臨時快閃場地");
    expect(groups[1]!.slots.map((s) => s.id)).toEqual([999]);
  });
});
