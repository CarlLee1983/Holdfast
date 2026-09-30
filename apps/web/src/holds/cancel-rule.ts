const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/**
 * 依資源的取消截止時間（開始前幾秒）產生給顧客看的規則文字。
 * 不足整分鐘的秒數進位到分鐘（截止只會更早，不會讓顧客誤判還來得及）。
 */
export function cancellationRuleText(cutoffSeconds: number): string {
  if (cutoffSeconds <= 0) return "開始用餐前都可自行取消";
  const totalMinutes = Math.ceil(cutoffSeconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const parts = [hours > 0 ? `${hours} 小時` : "", minutes > 0 ? `${minutes} 分鐘` : ""].filter(Boolean);
  return `可於用餐前 ${parts.join(" ")}前自行取消`;
}
