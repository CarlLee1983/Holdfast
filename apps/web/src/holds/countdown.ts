/**
 * 保留倒數的顯示邏輯（純函式）。只影響顯示，確認能否成立由 App Worker 判定。
 */

/** 剩餘毫秒 → `mm:ss`。不足 1 秒向上取整，讓 `00:00` 只在真正到期（剩餘 ≤ 0）時出現；超過 60 分鐘不補小時。 */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** 剩餘毫秒 ≤ 0 即到期（與伺服器「到期時間當下即不再占用」的邊界一致，只是提示）。 */
export function isCountdownExpired(remainingMs: number): boolean {
  return remainingMs <= 0;
}
