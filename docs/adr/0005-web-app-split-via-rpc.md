---
status: accepted
---

# Web Worker 與 App Worker 分開，以 Service Binding RPC 呼叫

Web Worker（Astro）只負責頁面與 HTTP 入口，會員、訂位等應用與領域邏輯全部在 App Worker（只以 RPC 對外，沒有 HTTP 路由，所以不用 Hono 等 HTTP 框架），兩者以 Service Binding 的 RPC（`WorkerEntrypoint`）呼叫，不走 HTTP fetch。拆分讓領域層不依賴 Astro，並使 Service Binding 本身成為 [ADR 0001](0001-experiment-wins-conflicts.md) 下的實測對象。依官方文件，Service Binding 不增加延遲、整條呼叫鏈只計一次請求——**已驗證（官方文件，經研究 agent 引用，未逐條複核）**，見 [`docs/research/cloudflare-concurrency.md`](../research/cloudflare-concurrency.md)。

**Considered Options:** 單一 Worker，Astro API routes 直接呼叫領域層——部署與測試較簡單，但領域層會被 Astro 的請求生命週期與建置方式綁住。

**Consequences:** 領域層的對外介面就是 App Worker 的 RPC 方法，Web Worker 不得直接存取 D1。部署順序固定為 App 先、Web 後，且 App 移除 RPC 方法前，Web 必須已停止呼叫它——否則兩次部署之間的空窗期會呼叫失敗。

**Falsified if:** 實測 Service Binding RPC 出現可感知的延遲或計費與文件不符，或兩個 Worker 的部署協調成本（版本不同步）成為常態問題。
