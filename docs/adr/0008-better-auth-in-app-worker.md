---
status: accepted
---

# 會員認證用 Better Auth，放在 App Worker

會員以 LINE Login 或 Google 登入，不設密碼，由 Better Auth 實作，實體放在 App Worker 並透過 Drizzle 存進 D1。Web Worker 只把 `/api/auth/*` 經 Service Binding 轉給 App Worker，並以 RPC 取得 session 放進 `Astro.locals`，因此仍守住 [ADR 0005](0005-web-app-split-via-rpc.md)「Web 不直接存取 D1」。LINE 會員一律以 `mapProfileToUser` 寫入不寄信的 placeholder email（`line-<sub>@members.holdfast.invalid`；Better Auth 會把 email 轉小寫，LINE userId 是 `U` 加小寫十六進位，所以轉小寫不會造成碰撞），不儲存 LINE 回傳的 email；原因是帳號連結關閉時，Better Auth 遇到 email 已存在會以 `account_not_linked` 拒絕登入，而 LINE 的 email 依 [ADR 0009](0009-member-is-an-account.md) 本來就未經驗證。

依據（見 [`docs/research/auth-libraries.md`](../research/auth-libraries.md)，經研究 agent 引用，未逐條複核）：Better Auth 內建 LINE 與 Google、支援 D1 / Drizzle，一般路徑不需互動式交易——**已驗證（原始碼）**；RPC 可傳遞 Request / Response——**已驗證（官方文件）**；認證放 App Worker 的整體切法——**推論**。

**Considered Options:**
- Auth.js——由 Better Auth 團隊接手、僅修安全性問題，`auth-astro` 自 2024-12 未更新且裝不上現行 `@auth/core`。
- Arctic / Oslo 自組——已棄用。
- 放在 Web Worker——Astro 整合較直接，但認證資料就得由 Web 存取 D1。

**Falsified if:** Better Auth 停止維護或某個更新開始要求互動式交易；或 `/api/auth/*` 轉發經 Service Binding 時 cookie / redirect 行為與直連不同而無法修正。
