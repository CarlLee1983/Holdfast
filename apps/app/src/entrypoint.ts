import { env, WorkerEntrypoint } from "cloudflare:workers";
import { createAuth } from "./auth/auth";
import { parseAuthConfig } from "./auth/config";
import { readMemberSession } from "./auth/session";
import { createAdminService } from "./admin/service";
import { createCatalogService } from "./catalog/service";
import { systemClock } from "./shared/clock";

// 載入時就驗證會員登入的設定：缺任何一個 secret 整個 App Worker 都起不來（含 catalog 與 admin RPC），
// 比登入時才發現好。頂層讀 env 只讀 vars 與 secrets，不做 I/O。
const authConfig = parseAuthConfig(env);

const AUTH_PATH_PREFIX = "/api/auth/";

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

  #admin() {
    return createAdminService(this.env.DB, systemClock, {
      teamDomain: this.env.ACCESS_TEAM_DOMAIN,
      audience: this.env.ACCESS_AUD,
      jwksJson: this.env.ACCESS_JWKS_JSON,
    });
  }

  #auth() {
    return createAuth(authConfig, this.env.DB);
  }

  /** Web Worker 把 `/api/auth/*` 原封轉來（ADR 0008）；App 沒有其他 HTTP 入口。 */
  fetch(request: Request): Promise<Response> | Response {
    if (!new URL(request.url).pathname.startsWith(AUTH_PATH_PREFIX)) {
      return new Response("Not Found", { status: 404 });
    }
    return this.#auth().handler(request);
  }

  /** 以瀏覽器的 cookie 換會員資訊；不是會員時 `member` 為 null。`setCookies` 要原樣附加到回給瀏覽器的回應。 */
  getMemberSession(cookie: string) {
    return readMemberSession(this.#auth(), cookie);
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
