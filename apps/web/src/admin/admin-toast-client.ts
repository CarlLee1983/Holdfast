/**
 * 後台輕量通知（Toast）：在畫面右下角顯示狀態訊息，避免整頁重新整理時的視覺跳動。
 */
export function showAdminToast(message: string, duration = 3000): void {
  if (typeof document === "undefined") return;

  let container = document.getElementById("admin-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "admin-toast-container";
    container.className = "admin-toast-container";
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-atomic", "true");
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "admin-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;

  container.appendChild(toast);

  // 稍微延遲加入 active 類別以觸發 CSS 過渡效果
  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });

  const timer = setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.addEventListener("transitionend", () => {
      toast.remove();
    }, { once: true });
  }, duration);

  toast.addEventListener("click", () => {
    clearTimeout(timer);
    toast.classList.remove("is-visible");
    toast.remove();
  });
}
