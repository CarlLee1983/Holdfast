/**
 * 取得要轉交給 App Worker 的 Access JWT。Web 只搬運，不解析、不判斷授權（ADR 0007）：
 * 有沒有權限完全由 App 驗簽決定。
 *
 * `ACCESS_DEV_JWT` 僅供本機開發（.dev.vars，已 gitignore）；preview / production 不得定義。
 */
export function readAccessJwt(request: Request, env: { ACCESS_DEV_JWT?: string }): string {
  return request.headers.get("Cf-Access-Jwt-Assertion") ?? env.ACCESS_DEV_JWT ?? "";
}
