import { applyBookingCancellation, type DrawerSlotData } from "./slot-drawer-state";
import { showAdminToast } from "./admin-toast-client";
import { formatTaipeiTime } from "../catalog/taipei-time";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function initAdminDrawer(): void {
  if (typeof document === "undefined") return;

  const drawer = document.getElementById("admin-slot-drawer");
  const drawerBackdrop = drawer?.querySelector(".admin-drawer-backdrop");
  const drawerCloseBtn = drawer?.querySelector(".admin-drawer-close");
  const drawerBody = drawer?.querySelector<HTMLElement>(".admin-drawer-body");
  const cancelDialog = document.getElementById("admin-cancel-dialog") as HTMLDialogElement | null;
  const cancelForm = cancelDialog?.querySelector("form") as HTMLFormElement | null;
  const cancelErrorEl = cancelDialog?.querySelector(".dialog-error") as HTMLElement | null;

  if (!drawer || !drawerBody) return;
  const body = drawerBody;

  let currentSlot: DrawerSlotData | null = null;
  let activeCancelBooking: { id: number; seats: number; memberName: string } | null = null;


  function closeDrawer() {
    drawer!.classList.remove("is-open");
    drawer!.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
  }

  function openDrawer(slot: DrawerSlotData) {
    currentSlot = slot;
    renderDrawer(slot);
    drawer!.classList.add("is-open");
    drawer!.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
  }

  function updateSlotOnPage(slot: DrawerSlotData) {
    // 尋找頁面上所有對應此時段的元素進行就地更新
    const triggerElements = document.querySelectorAll(`[data-slot-id="${slot.id}"]`);
    for (const el of triggerElements) {
      const occupiedEl = el.querySelector(".slot-occupied-count");
      if (occupiedEl) occupiedEl.textContent = `${slot.occupied}／${slot.capacity}`;

      const remainingEl = el.querySelector(".slot-remaining-count");
      if (remainingEl) remainingEl.textContent = `剩 ${slot.remainingSeats}`;

      const progressEl = el.querySelector<HTMLElement>(".slot-progress-bar");
      if (progressEl) {
        const pct = Math.min(100, slot.capacity > 0 ? (slot.occupied / slot.capacity) * 100 : 0);
        progressEl.style.width = `${pct}%`;
      }

      // 更新超占標籤
      const overcommittedEl = el.querySelector(".tag-overcommitted");
      if (overcommittedEl) {
        overcommittedEl.classList.toggle("is-visible", slot.overcommitted);
      }
    }

    // 更新 embedded script 標籤
    const scriptEl = document.getElementById(`slot-data-${slot.id}`);
    if (scriptEl) {
      scriptEl.textContent = JSON.stringify(slot);
    }
  }

  function renderDrawer(slot: DrawerSlotData) {
    const now = Date.now();
    const isStarted = slot.startsAt <= now;
    const timeStr = `${formatTaipeiTime(slot.startsAt)}–${formatTaipeiTime(slot.endsAt)}`;

    let html = `
      <div class="drawer-section drawer-summary">
        <div class="drawer-header-info">
          <h3>${escapeHtml(slot.resourceName)}</h3>
          <p class="drawer-time">${timeStr}</p>
        </div>
        <div class="drawer-capacity-bar">
          <div class="capacity-labels">
            <span>占用名額：<strong>${slot.occupied}</strong> ／ ${slot.capacity}</span>
            <span>剩餘：<strong>${slot.remainingSeats}</strong></span>
          </div>
          <div class="progress-track">
            <div class="slot-progress-bar" style="width: ${Math.min(100, (slot.occupied / slot.capacity) * 100)}%"></div>
          </div>
          ${slot.overcommitted ? `<span class="tag tag--danger">時段已超占</span>` : ""}
          ${slot.remainingSeats === 0 ? `<span class="tag">名額已額滿</span>` : ""}
          ${isStarted ? `<span class="tag tag--quiet">時段已開始（無法再取消）</span>` : ""}
        </div>
      </div>

      <div class="drawer-section">
        <h4>正式訂位 (${slot.bookings.length})</h4>
        ${
          slot.bookings.length === 0
            ? `<p class="empty-state">尚無正式訂位</p>`
            : `<ul class="drawer-list">
                ${slot.bookings
                  .map(
                    (b) => `
                  <li class="drawer-list-item">
                    <div class="item-info">
                      <strong>${escapeHtml(b.memberName ?? "已刪除會員")}</strong>
                      <span class="seat-badge">${b.seats} 位</span>
                    </div>
                    ${
                      !isStarted
                        ? `<button type="button" class="btn-cancel-booking" data-booking-id="${b.id}" data-seats="${b.seats}" data-member="${escapeHtml(b.memberName ?? "會員")}">取消訂位</button>`
                        : ""
                    }
                  </li>
                `,
                  )
                  .join("")}
              </ul>`
        }
      </div>

      <div class="drawer-section">
        <h4>保留中 (${slot.holds.length})</h4>
        ${
          slot.holds.length === 0
            ? `<p class="empty-state">尚無保留中的名額</p>`
            : `<ul class="drawer-list">
                ${slot.holds
                  .map(
                    (h) => `
                  <li class="drawer-list-item is-held">
                    <div class="item-info">
                      <span>${escapeHtml(h.memberName ?? "已刪除會員")}</span>
                      <span class="seat-badge">${h.seats} 位</span>
                    </div>
                    <span class="tag tag--quiet">保留至 ${formatTaipeiTime(h.expiresAt)}</span>
                  </li>
                `,
                  )
                  .join("")}
              </ul>`
        }
      </div>

      ${
        slot.cancelledBookings.length > 0
          ? `
        <div class="drawer-section">
          <h4>已取消紀錄 (${slot.cancelledBookings.length})</h4>
          <ul class="drawer-list">
            ${slot.cancelledBookings
              .map(
                (c) => `
              <li class="drawer-list-item is-cancelled">
                <div class="item-info">
                  <span class="cancelled-name">${escapeHtml(c.memberName ?? "已刪除會員")}</span>
                  <span>${c.seats} 位</span>
                  <span class="tag tag--quiet">${c.cancelledBy === "admin" ? "店家取消" : c.cancelledBy === "member" ? "會員取消" : "已取消"}</span>
                </div>
                ${c.cancellationReason ? `<p class="meta">原因：${escapeHtml(c.cancellationReason)}</p>` : ""}
              </li>
            `,
              )
              .join("")}
          </ul>
        </div>
      `
          : ""
      }

      <div class="drawer-footer">
        <a href="/admin/slots/${slot.id}">進入時段獨立頁管理 →</a>
      </div>
    `;

    body.innerHTML = html;

    // 綁定抽屜內取消按鈕點擊
    body.querySelectorAll<HTMLButtonElement>(".btn-cancel-booking").forEach((btn) => {
      btn.addEventListener("click", () => {
        const bookingId = Number(btn.dataset.bookingId);
        const seats = Number(btn.dataset.seats);
        const memberName = btn.dataset.member || "會員";
        openCancelDialog({ id: bookingId, seats, memberName });
      });
    });
  }

  function openCancelDialog(booking: { id: number; seats: number; memberName: string }) {
    if (!cancelDialog || !cancelForm || !currentSlot) return;
    activeCancelBooking = booking;

    const slotIdInput = cancelForm.querySelector<HTMLInputElement>("input[name=slotId]");
    const bookingIdInput = cancelForm.querySelector<HTMLInputElement>("input[name=bookingId]");
    const targetDesc = cancelDialog.querySelector<HTMLElement>(".cancel-target-desc");
    const reasonInput = cancelForm.querySelector<HTMLInputElement>("input[name=reason]");

    if (slotIdInput) slotIdInput.value = String(currentSlot.id);
    if (bookingIdInput) bookingIdInput.value = String(booking.id);
    if (targetDesc) {
      targetDesc.textContent = `${booking.memberName}（${booking.seats} 位）在 ${formatTaipeiTime(currentSlot.startsAt)}–${formatTaipeiTime(currentSlot.endsAt)} 的訂位`;
    }
    if (reasonInput) reasonInput.value = "";
    if (cancelErrorEl) {
      cancelErrorEl.textContent = "";
      cancelErrorEl.style.display = "none";
    }

    cancelDialog.showModal();
  }

  // 監聽所有 slot trigger 點擊
  document.addEventListener("click", (e) => {
    const trigger = (e.target as HTMLElement).closest<HTMLElement>("[data-slot-trigger]");
    if (!trigger) return;

    // 阻止原生連結跳轉（若已有 JS）
    e.preventDefault();

    const slotId = trigger.getAttribute("data-slot-id");
    if (!slotId) return;

    const dataScript = document.getElementById(`slot-data-${slotId}`);
    if (!dataScript || !dataScript.textContent) {
      // 若找不到內嵌資料，退回原本跳轉行為
      window.location.href = `/admin/slots/${slotId}`;
      return;
    }

    try {
      const slotData: DrawerSlotData = JSON.parse(dataScript.textContent);
      openDrawer(slotData);
    } catch {
      window.location.href = `/admin/slots/${slotId}`;
    }
  });

  // 抽屜關閉控制
  drawerCloseBtn?.addEventListener("click", closeDrawer);
  drawerBackdrop?.addEventListener("click", closeDrawer);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("is-open")) {
      closeDrawer();
    }
  });

  // 取消訂位表單 Ajax 攔截
  cancelForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentSlot || !activeCancelBooking) return;

    const submitBtn = cancelForm.querySelector<HTMLButtonElement>("button[type=submit]");
    if (submitBtn) submitBtn.disabled = true;

    if (cancelErrorEl) {
      cancelErrorEl.textContent = "";
      cancelErrorEl.style.display = "none";
    }

    const formData = new FormData(cancelForm);
    const actionUrl = cancelForm.getAttribute("action") || window.location.href;

    try {
      const response = await fetch(actionUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (response.ok && result.ok) {
        cancelDialog?.close();
        showAdminToast("訂位已取消，名額已歸還。");

        const reason = String(formData.get("reason") || "");
        const updated = applyBookingCancellation(currentSlot, activeCancelBooking.id, reason, Date.now());
        currentSlot = updated;

        // 即時局部重繪抽屜與首頁上的時段資訊
        renderDrawer(updated);
        updateSlotOnPage(updated);
      } else {
        const errorMsg = result.error || "取消失敗，請稍後再試。";
        if (cancelErrorEl) {
          cancelErrorEl.textContent = errorMsg;
          cancelErrorEl.style.display = "block";
        }
      }
    } catch (err) {
      if (cancelErrorEl) {
        cancelErrorEl.textContent = "連線發生錯誤，請稍後再試。";
        cancelErrorEl.style.display = "block";
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // 取消 Dialog 關閉控制
  cancelDialog?.querySelector(".dialog-close-btn")?.addEventListener("click", () => {
    cancelDialog.close();
  });
}
