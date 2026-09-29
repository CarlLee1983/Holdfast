import { drizzle } from "drizzle-orm/d1";
import type { Clock } from "../shared/clock";
import { fail, ok, type Result } from "../shared/result";
import {
  resourceExists,
  selectResources,
  selectSlotAvailability,
  type ResourceSummary,
  type SlotAvailability,
} from "./queries";

export type ListSlotsResult = Result<SlotAvailability[], "resource_not_found">;

export function createCatalogService(d1: D1Database, clock: Clock) {
  const db = drizzle(d1);

  return {
    async listResources(): Promise<Result<ResourceSummary[], never>> {
      return ok(await selectResources(db));
    },

    /** 公開列表只顯示尚未結束的時段。 */
    async listSlots(resourceId: number): Promise<ListSlotsResult> {
      if (!(await resourceExists(db, resourceId))) {
        return fail("resource_not_found");
      }
      return ok(await selectSlotAvailability(db, resourceId, clock.now()));
    },
  };
}
