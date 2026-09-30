export interface SlotBookingLike {
  id: number;
  memberName: string | null;
  seats: number;
}

export interface SlotHoldLike extends SlotBookingLike {
  expiresAt: number;
}

export interface SlotCancelledBookingLike extends SlotBookingLike {
  cancelledBy: "admin" | "member" | null;
  cancelledAt: number | null;
  cancellationReason: string | null;
}

export interface AgendaSlotLike {
  id: number;
  resourceId: number;
  resourceName: string;
  resourceRetiredAt: number | null;
  startsAt: number;
  endsAt: number;
  capacity: number;
  occupied: number;
  remainingSeats: number;
  overcommitted: boolean;
  bookings: SlotBookingLike[];
  holds: SlotHoldLike[];
  cancelledBookings: SlotCancelledBookingLike[];
}

export interface ResourceSummaryLike {
  id: number;
  name: string;
  retiredAt: number | null;
}

export interface ResourceSlotGroup<S extends AgendaSlotLike = AgendaSlotLike> {
  resource: ResourceSummaryLike;
  slots: S[];
}

/**
 * 依資源將時段分組，保留所有傳入的資源列，並確保每組內的時段依 startsAt 遞增排序。
 */
export function groupSlotsByResource<S extends AgendaSlotLike, R extends ResourceSummaryLike>(
  slots: S[],
  resources: R[],
): ResourceSlotGroup<S>[] {
  const map = new Map<number, { resource: ResourceSummaryLike; slots: S[] }>();

  // 1. 先為所有已知資源建好空組
  for (const r of resources) {
    map.set(r.id, {
      resource: { id: r.id, name: r.name, retiredAt: r.retiredAt },
      slots: [],
    });
  }

  // 2. 將時段填入對應的資源組
  for (const slot of slots) {
    let group = map.get(slot.resourceId);
    if (!group) {
      group = {
        resource: {
          id: slot.resourceId,
          name: slot.resourceName,
          retiredAt: slot.resourceRetiredAt,
        },
        slots: [],
      };
      map.set(slot.resourceId, group);
    }
    group.slots.push(slot);
  }

  // 3. 對每組內的時段依 startsAt 排序
  for (const group of map.values()) {
    group.slots.sort((a, b) => a.startsAt - b.startsAt || a.id - b.id);
  }

  return Array.from(map.values());
}
