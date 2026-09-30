/**
 * 防重複送出（漸進增強），會員頁與管理後台的版型共用：以事件委派涵蓋所有 method="post" 的表單，
 * 送出後停用送出按鈕。沒有 JS 時表單照常送出，伺服器端與表單欄位都不受影響。
 *
 * 停用放在 submit 事件而非 click：原生驗證失敗（例如名額超出 max）時不會觸發 submit，按鈕因此維持可按；
 * 在 submit 事件中停用按鈕也不會取消這次送出，但被停用的控制項不會進表單資料，
 * 所以送出的按鈕本身不可帶 name／value；要送出的值一律放 hidden input。
 */
const SUBMITTING = "submitting";

export function guardDoubleSubmit(): void {
  document.addEventListener("submit", (event) => {
    // 已被其他處理器 preventDefault 就不會送出，不該停用按鈕
    if (event.defaultPrevented) return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method !== "post") return;
    const button = event.submitter ?? form.querySelector("button[type=submit], input[type=submit]");
    if (!(button instanceof HTMLButtonElement || button instanceof HTMLInputElement) || button.disabled) return;
    button.disabled = true;
    button.dataset[SUBMITTING] = "";
  });

  // 從 bfcache 返回時頁面不會重新載入，被停用的按鈕會一直停用。
  // 只恢復帶 data-submitting 標記的按鈕：確認頁的倒數到期後（countdown-client.ts）停用的「確認訂位」沒有這個標記，維持停用。
  // 例外約定：帶 data-expired（倒數到期時由 countdown-client.ts 設定）的按鈕即使也有 data-submitting，仍不恢復可按，只移除送出標記
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    for (const button of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("[data-submitting]")) {
      delete button.dataset[SUBMITTING];
      if (!button.hasAttribute("data-expired")) button.disabled = false;
    }
  });
}
