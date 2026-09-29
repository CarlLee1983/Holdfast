/** 只有 `/api/auth/` 底下的請求原封轉給 App Worker（ADR 0008）。 */
export function isAuthPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/");
}

// 只用來判斷「解析後是不是仍在站內」，不會出現在結果裡
const SENTINEL_ORIGIN = "https://sentinel.invalid";

/**
 * 登入後要回去的路徑：只接受站內路徑，其他一律回首頁（避免 open redirect）。
 * 不自己猜瀏覽器怎麼解析（URL 解析器會吃掉 tab、換行，並把 `\\` 當成 `/`），
 * 而是實際對一個假 origin 解析，origin 變了就拒絕；回傳解析後的 pathname + search + hash。
 */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/";
  let resolved: URL;
  try {
    resolved = new URL(value, SENTINEL_ORIGIN);
  } catch {
    return "/";
  }
  if (resolved.origin !== SENTINEL_ORIGIN) return "/";
  return resolved.pathname + resolved.search + resolved.hash;
}

/** 未登入訪客要去登入頁的網址，登入後回到 `url` 這一頁。 */
export function loginUrl(url: URL): string {
  return `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/** Better Auth 的 session cookie（https 下帶 `__Secure-` 前綴）。沒有它就不必問 App Worker。 */
export function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .some((part) => /^(__Secure-)?better-auth\.session_token=/.test(part.trim()));
}
