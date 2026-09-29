import { WorkerEntrypoint } from "cloudflare:workers";
import { createAdminService } from "./admin/service";
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

  #admin() {
    return createAdminService(this.env.DB, systemClock, {
      teamDomain: this.env.ACCESS_TEAM_DOMAIN,
      audience: this.env.ACCESS_AUD,
      jwksJson: this.env.ACCESS_JWKS_JSON,
    });
  }

  listResources() {
    return this.#catalog().listResources();
  }

  listSlots(resourceId: number) {
    return this.#catalog().listSlots(resourceId);
  }

  // 管理 RPC（ADR 0007）：第一個參數是 Cloudflare Access 的原始 JWT，由 App 自行驗簽，
  // 不信任呼叫端的任何身分聲明。輸入以 unknown 接收，在邊界用 zod 驗證。
  listResourcesForAdmin(jwt: string) {
    return this.#admin().listResourcesForAdmin(jwt);
  }

  createResource(jwt: string, input: unknown) {
    return this.#admin().createResource(jwt, input);
  }

  updateResource(jwt: string, input: unknown) {
    return this.#admin().updateResource(jwt, input);
  }

  createSlot(jwt: string, input: unknown) {
    return this.#admin().createSlot(jwt, input);
  }
}

export default AppEntrypoint;
