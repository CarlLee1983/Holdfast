import { formatTaipeiDate, formatTaipeiTime, formatTaipeiDateTime, taipeiDateKey } from "../catalog/taipei-time";

interface MemberSummary {
  id: string;
  name: string;
  email: string;
}

interface MemberReservation {
  id: number;
  slotId: number;
  resourceName: string;
  startsAt: number;
  endsAt: number;
  seats: number;
}

interface MemberActiveHold extends MemberReservation {
  expiresAt: number;
}

interface MemberDetail {
  member: MemberSummary;
  holds: MemberActiveHold[];
  bookings: MemberReservation[];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function initOmniMemberSearch(): void {
  if (typeof document === "undefined") return;

  const triggerBtn = document.getElementById("open-member-search");
  const dialog = document.getElementById("omni-member-search-dialog") as HTMLDialogElement | null;
  const input = document.getElementById("omni-search-input") as HTMLInputElement | null;
  const resultsContainer = document.getElementById("omni-search-results");
  const previewContainer = document.getElementById("omni-member-preview");
  const closeBtn = dialog?.querySelector(".dialog-close-btn");

  if (!dialog || !input || !resultsContainer || !previewContainer) return;

  function openSearch() {
    dialog!.showModal();
    input!.value = "";
    resultsContainer!.innerHTML = `<p class="meta">請輸入至少一個字元開始搜尋...</p>`;
    previewContainer!.style.display = "none";
    previewContainer!.innerHTML = "";
    input!.focus();
  }

  function closeSearch() {
    dialog!.close();
  }

  triggerBtn?.addEventListener("click", openSearch);
  closeBtn?.addEventListener("click", closeSearch);

  // 鍵盤快捷鍵：按下 "/" 且非在輸入欄位時，喚起搜尋
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && !dialog.open) {
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
      e.preventDefault();
      openSearch();
    }
  });

  let debounceTimer: ReturnType<typeof setTimeout>;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      resultsContainer.innerHTML = `<p class="meta">請輸入至少一個字元開始搜尋...</p>`;
      previewContainer.style.display = "none";
      return;
    }

    debounceTimer = setTimeout(async () => {
      resultsContainer.innerHTML = `<p class="meta">搜尋中...</p>`;
      try {
        const res = await fetch(`/admin/members?q=${encodeURIComponent(q)}`, {
          headers: { Accept: "application/json" },
        });
        const json = (await res.json()) as { ok: boolean; data?: MemberSummary[]; error?: string };

        if (!json.ok || !json.data || json.data.length === 0) {
          resultsContainer.innerHTML = `<p class="meta">找不到符合「${escapeHtml(q)}」的會員。</p>`;
          previewContainer.style.display = "none";
          return;
        }

        resultsContainer.innerHTML = `
          <ul class="omni-results-list">
            ${json.data
              .map(
                (m) => `
              <li>
                <button type="button" class="omni-member-item" data-member-id="${m.id}">
                  <strong>${escapeHtml(m.name)}</strong>
                  <span class="meta">${escapeHtml(m.email)}</span>
                </button>
              </li>
            `,
              )
              .join("")}
          </ul>
        `;

        resultsContainer.querySelectorAll<HTMLButtonElement>(".omni-member-item").forEach((btn) => {
          btn.addEventListener("click", () => {
            const id = btn.dataset.memberId;
            if (id) loadMemberPreview(id);
          });
        });
      } catch {
        resultsContainer.innerHTML = `<p class="error">搜尋連線失敗，請重試。</p>`;
      }
    }, 200);
  });

  async function loadMemberPreview(memberId: string) {
    previewContainer!.style.display = "block";
    previewContainer!.innerHTML = `<p class="meta">載入會員詳情...</p>`;

    try {
      const res = await fetch(`/admin/members/${encodeURIComponent(memberId)}`, {
        headers: { Accept: "application/json" },
      });
      const json = (await res.json()) as { ok: boolean; data?: MemberDetail; error?: string };

      if (!json.ok || !json.data) {
        previewContainer!.innerHTML = `<p class="error">${escapeHtml(json.error || "無法載入會員資料")}</p>`;
        return;
      }

      const { member, bookings, holds } = json.data;
      const html = `
        <div class="member-preview-card">
          <div class="preview-header">
            <h4>${escapeHtml(member.name)}</h4>
            <p class="meta">${escapeHtml(member.email)}</p>
          </div>

          <div class="preview-section">
            <h5>未來訂位 (${bookings.length})</h5>
            ${
              bookings.length === 0
                ? `<p class="meta">無未來訂位</p>`
                : `<ul class="preview-list">
                    ${bookings
                      .map(
                        (b) => `
                      <li>
                        <div>
                          <strong>${escapeHtml(b.resourceName)}</strong>・${b.seats} 位
                          <div class="meta">${formatTaipeiDate(b.startsAt)} ${formatTaipeiTime(b.startsAt)}–${formatTaipeiTime(b.endsAt)}</div>
                        </div>
                        <a class="tag tag--quiet" href="/admin?date=${taipeiDateKey(b.startsAt)}">前往當日</a>
                      </li>
                    `,
                      )
                      .join("")}
                  </ul>`
            }
          </div>

          <div class="preview-section">
            <h5>有效保留 (${holds.length})</h5>
            ${
              holds.length === 0
                ? `<p class="meta">無有效保留</p>`
                : `<ul class="preview-list">
                    ${holds
                      .map(
                        (h) => `
                      <li>
                        <div>
                          <strong>${escapeHtml(h.resourceName)}</strong>・${h.seats} 位
                          <div class="meta">${formatTaipeiDate(h.startsAt)} ${formatTaipeiTime(h.startsAt)}–${formatTaipeiTime(h.endsAt)}</div>
                          <div class="meta">到期：${formatTaipeiDateTime(h.expiresAt)}</div>
                        </div>
                        <a class="tag tag--quiet" href="/admin?date=${taipeiDateKey(h.startsAt)}">前往當日</a>
                      </li>
                    `,
                      )
                      .join("")}
                  </ul>`
            }
          </div>

          <div class="preview-footer">
            <a href="/admin/members/${encodeURIComponent(member.id)}">前往完整會員主頁 →</a>
          </div>
        </div>
      `;
      previewContainer!.innerHTML = html;
    } catch {
      previewContainer!.innerHTML = `<p class="error">連線失敗，無法取得會員詳情。</p>`;
    }
  }
}
