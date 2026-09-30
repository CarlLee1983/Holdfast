const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** 秒數 → 「N 小時 M 分鐘」。不足整分鐘的秒數進位到分鐘；為 0 的單位省略。 */
export function durationText(seconds: number): string {
  const totalMinutes = Math.ceil(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return [hours > 0 ? `${hours} 小時` : "", minutes > 0 ? `${minutes} 分鐘` : ""].filter(Boolean).join(" ");
}

/** 依資源的保留期限（秒）產生給顧客看的須知文字。 */
export function holdTtlRuleText(ttlSeconds: number): string {
  return `保留 ${durationText(ttlSeconds)}，逾時自動釋放`;
}
