import { formatCountdown, isCountdownExpired } from "./countdown";

/**
 * 保留倒數的用戶端行為，/me 與確認頁共用。DOM 約定（樣式在 styles/base.css）：
 * - 每一列倒數是一個 `[data-remaining-ms]` 元素，值是伺服器算出的剩餘毫秒；選用 `data-label`，到期時用於播報。
 * - 列內必須有 `.hold-countdown`（預設 hidden 的倒數區塊）與其中的 `.countdown-text`（倒數文字）；缺少任一個的列直接略過。
 * - 列內選用 `button[data-confirm]`（到期時停用）與 `a[data-continue]`（「繼續確認」連結，到期時隱藏，免得點進 404）。
 * - 頁面上要有唯一預先存在的 `#hold-announcer`（aria-live），到期時把訊息寫進去播報。
 *
 * 起點是伺服器渲染時算出的剩餘毫秒，之後只用單調時間（performance.now）累計經過時間；
 * 不讀用戶端時鐘的絕對時間，因為到期時鐘在伺服器端（ADR 0011），用戶端時鐘可能偏移。
 * 取捨：手機休眠時 performance.now() 可能暫停，倒數會落後，但只會比伺服器晚到期（顯示比實際長），
 * 不會擋掉仍有效的確認；確認能否成立仍完全由伺服器判定
 */
export function startHoldCountdowns(): void {
  const startedAt = performance.now();
  const announcer = document.querySelector<HTMLElement>("#hold-announcer");
  const rows = [...document.querySelectorAll<HTMLElement>("[data-remaining-ms]")].flatMap((row) => {
    const countdown = row.querySelector<HTMLElement>(".hold-countdown");
    const text = row.querySelector<HTMLElement>(".countdown-text");
    if (!countdown || !text) return [];
    return [
      {
        initialMs: Number(row.dataset.remainingMs),
        label: row.dataset.label ?? "",
        countdown,
        text,
        confirm: row.querySelector<HTMLButtonElement>("button[data-confirm]"),
        continueLink: row.querySelector<HTMLElement>("a[data-continue]"),
        expired: false,
      },
    ];
  });

  const tick = () => {
    const elapsed = performance.now() - startedAt;
    const justExpired: string[] = [];
    for (const item of rows) {
      if (item.expired) continue;
      const remaining = item.initialMs - elapsed;
      if (!isCountdownExpired(remaining)) {
        item.text.textContent = formatCountdown(remaining);
        item.countdown.hidden = false;
        continue;
      }
      item.expired = true;
      if (item.confirm) {
        item.confirm.disabled = true;
        // 約定：帶 data-expired 的按鈕不可被恢復。MemberLayout 的 bfcache 還原（pageshow）會恢復帶 data-submitting 的按鈕，
        // 但要跳過這顆——否則「送出確認後、伺服器回應前到期，再從 bfcache 返回」會讓已到期的按鈕變回可按
        item.confirm.dataset.expired = "";
      }
      // 已到期的保留再點進去只會是 404，所以連結一併隱藏
      if (item.continueLink) item.continueLink.hidden = true;
      // 該列換成純文字；報讀交給頁面上唯一預先存在的 aria-live 區，頁面不自動重新整理
      item.countdown.textContent = "已到期";
      item.countdown.classList.add("hold-expired");
      item.countdown.hidden = false;
      justExpired.push(`${item.label} 的保留已到期`);
    }
    // 同一次 tick 內多筆到期合併成一句，只更新一次播報區
    if (announcer && justExpired.length > 0) announcer.textContent = justExpired.join("；");
    if (rows.every((item) => item.expired)) clearInterval(timer);
  };

  const timer = setInterval(tick, 1000);
  tick();
}
