import { WorkerEntrypoint } from "cloudflare:workers";
import { createAuth, type Auth } from "./auth/auth";
import { AuthConfigError, parseAuthConfig } from "./auth/config";
import { AUTH_PATH_PREFIX } from "./auth/paths";
import { readMemberSession } from "./auth/session";
import { createAccountService } from "./account/service";
import { createAdminService } from "./admin/service";
import { createCatalogService } from "./catalog/service";
import { createHoldService } from "./holds/service";
import { systemClock } from "./shared/clock";

/**
 * App Worker 對外的介面（ADR 0005）：Web Worker 經 Service Binding 呼叫這些 RPC 方法。
 * 業務方法回傳 `Result`，業務拒絕以具名 reason 表達；`getMemberSession` 是例外：
 * 「不是會員」是常態而不是拒絕，且要一併帶回 Set-Cookie，所以回傳 `MemberSessionLookup`。
 * `fetch` 只處理 `/api/auth/`，回傳 Better Auth 的 Response。
 */
export class AppEntrypoint extends WorkerEntrypoint<Env> {
  #catalog() {
    return createCatalogService(this.env.DB, systemClock);
  }

  #holds() {
    return createHoldService(this.env.DB, systemClock);
  }

  #account() {
    return createAccountService(this.env.DB, systemClock);
  }

  #admin() {
    return createAdminService(this.env.DB, systemClock, {
      teamDomain: this.env.ACCESS_TEAM_DOMAIN,
      audience: this.env.ACCESS_AUD,
      jwksJson: this.env.ACCESS_JWKS_JSON,
    });
  }

  /**
   * 會員登入的設定在這裡才驗證，不在模組載入時：設定缺漏只讓 auth 路徑失敗，catalog 與管理 RPC 照常運作
   * （ADR 0008）。失敗時記一行只含變數名稱的 log 再丟出。
   */
  #auth() {
    try {
      return createAuth(parseAuthConfig(this.env), this.env.DB);
    } catch (error) {
      if (error instanceof AuthConfigError) {
        console.error(JSON.stringify({ event: "auth_config_invalid", error: error.message }));
      }
      throw error;
    }
  }

  /** Web Worker 把 `/api/auth/*` 原封轉來（ADR 0008）；App 沒有其他 HTTP 入口。 */
  fetch(request: Request): Promise<Response> | Response {
    if (!new URL(request.url).pathname.startsWith(AUTH_PATH_PREFIX)) {
      return new Response("Not Found", { status: 404 });
    }
    let auth: Auth;
    try {
      auth = this.#auth();
    } catch (error) {
      if (error instanceof AuthConfigError) return new Response("Service Unavailable", { status: 503 });
      throw error;
    }
    return auth.handler(request);
  }

  /** 以瀏覽器的 cookie 換會員資訊；不是會員時 `member` 為 null。`setCookies` 要原樣附加到回給瀏覽器的回應。 */
  async getMemberSession(cookie: string) {
    return readMemberSession(this.#auth(), cookie);
  }

  listResources() {
    return this.#catalog().listResources();
  }

  listSlots(resourceId: number) {
    return this.#catalog().listSlots(resourceId);
  }

  // 會員 RPC：`memberId` 由 Web 從 session 解析出來後帶入，App 信任它（不再驗 session），只擋空值。
  // 輸入以 unknown 接收，在邊界用 zod 驗證。
  createHold(memberId: string, input: unknown) {
    return this.#holds().createHold(memberId, input);
  }

  listMyHolds(memberId: string) {
    return this.#holds().listMyHolds(memberId);
  }

  confirmHold(memberId: string, input: unknown) {
    return this.#holds().confirmHold(memberId, input);
  }

  cancelBooking(memberId: string, input: unknown) {
    return this.#holds().cancelBooking(memberId, input);
  }

  listMyBookings(memberId: string) {
    return this.#holds().listMyBookings(memberId);
  }

  /** 刪除會員帳號：未來的訂位取消、保留中的保留（含已過期尚未清理的）釋放、Better Auth 資料移除；重複呼叫是成功的 no-op。 */
  deleteAccount(memberId: string) {
    return this.#account().deleteAccount(memberId);
  }

  releaseExpiredHolds() {
    return this.#holds().releaseExpiredHolds();
  }

  async scheduled(_controller: ScheduledController): Promise<void> {
    await this.releaseExpiredHolds();
  }

  // 管理 RPC（ADR 0007）：第一個參數是 Cloudflare Access 的原始 JWT，由 App 自行驗簽，
  // 不信任呼叫端的任何身分聲明。輸入以 unknown 接收，在邊界用 zod 驗證。
  listResourcesForAdmin(jwt: string) {
    return this.#admin().listResourcesForAdmin(jwt);
  }

  listAuditForAdmin(jwt: string, input: unknown) {
    return this.#admin().listAuditForAdmin(jwt, input);
  }

  getResourceForAdmin(jwt: string, resourceId: number) {
    return this.#admin().getResourceForAdmin(jwt, resourceId);
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

  listSlotsForAdmin(jwt: string, resourceId: number) {
    return this.#admin().listSlotsForAdmin(jwt, resourceId);
  }

  updateSlotCapacity(jwt: string, input: unknown) {
    return this.#admin().updateSlotCapacity(jwt, input);
  }

  deleteSlot(jwt: string, input: unknown) {
    return this.#admin().deleteSlot(jwt, input);
  }

  listSlotHoldsAndBookingsForAdmin(jwt: string, input: unknown) {
    return this.#admin().listSlotHoldsAndBookingsForAdmin(jwt, input);
  }

  cancelBookingForAdmin(jwt: string, input: unknown) {
    return this.#admin().cancelBookingForAdmin(jwt, input);
  }
}

export default AppEntrypoint;
