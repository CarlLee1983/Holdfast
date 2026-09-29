import { WorkerEntrypoint } from "cloudflare:workers";
import { createCatalogService } from "./catalog/service";
import { systemClock } from "./shared/clock";

/**
 * App Worker 對外的介面（ADR 0005）：Web Worker 經 Service Binding 呼叫這些 RPC 方法。
 * 每個方法回傳 `Result`，業務拒絕以具名 reason 表達。
 */
export class AppEntrypoint extends WorkerEntrypoint<Env> {
  #catalog() {
    return createCatalogService(this.env.DB, systemClock);
  }

  listResources() {
    return this.#catalog().listResources();
  }

  listSlots(resourceId: number) {
    return this.#catalog().listSlots(resourceId);
  }
}

export default AppEntrypoint;
