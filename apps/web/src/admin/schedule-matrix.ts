import type { AgendaSlotLike, ResourceSummaryLike } from "./agenda-matrix";
import type { WeekDayInfo } from "./schedule-date";
import { taipeiDateKey } from "../catalog/taipei-time";

export interface ScheduleDayCell<S = AgendaSlotLike> {
  dayInfo: WeekDayInfo;
  slots: S[];
}

export interface ScheduleResourceRow<S = AgendaSlotLike> {
  resource: ResourceSummaryLike;
  days: ScheduleDayCell<S>[];
}

/**
 * 將一週內的時段依資源與各日期分組，便於以週曆矩陣呈現排程。
 */
export function groupScheduleByResourceAndDay<S extends AgendaSlotLike, R extends ResourceSummaryLike>(
  slots: S[],
  resources: R[],
  weekDays: WeekDayInfo[],
): ScheduleResourceRow<S>[] {
  const result: ScheduleResourceRow<S>[] = [];

  for (const resource of resources) {
    const days: ScheduleDayCell<S>[] = weekDays.map((dayInfo) => ({
      dayInfo,
      slots: [],
    }));

    const dayMap = new Map<string, S[]>();
    for (const d of days) {
      dayMap.set(d.dayInfo.dateKey, d.slots);
    }

    for (const slot of slots) {
      if (slot.resourceId === resource.id) {
        const key = taipeiDateKey(slot.startsAt);
        const daySlots = dayMap.get(key);
        if (daySlots) {
          daySlots.push(slot);
        }
      }
    }

    // 每一天內的時段依開始時間排序
    for (const d of days) {
      d.slots.sort((a, b) => a.startsAt - b.startsAt || a.id - b.id);
    }

    result.push({
      resource: {
        id: resource.id,
        name: resource.name,
        retiredAt: resource.retiredAt,
      },
      days,
    });
  }

  return result;
}
