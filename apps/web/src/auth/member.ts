/** 只有 `/api/auth/` 底下的請求原封轉給 App Worker（ADR 0008）。 */
export function isAuthPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/");
}

/** 登入後要回去的路徑：只接受站內相對路徑，其他一律回首頁（避免 open redirect）。 */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

/** 未登入訪客要去登入頁的網址，登入後回到 `url` 這一頁。 */
export function loginUrl(url: URL): string {
  return `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
}
