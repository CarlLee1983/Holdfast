---
status: accepted
---

# 管理者身分交給 Cloudflare Access，不與會員共用認證

`/admin` 前面放 Cloudflare Access，管理者身分完全不進 D1；應用程式只驗證 Access 簽發的 JWT，取消訂位等操作以 JWT 裡的 email 記錄操作者。會員認證與管理者認證因此互不相干：會員認證套件的漏洞或設定錯誤，不會變成後台權限。Access 本身也是 [ADR 0001](0001-experiment-wins-conflicts.md) 下的實測對象。

**Considered Options:** 與會員共用社群登入，以 email 名單標記管理者——少一個外部元件，但後台的安全性就等於會員登入流程最弱的一環。

**Consequences:** Web Worker 與 App Worker 都不信任前端傳來的管理者身分，只信任 Access JWT（須驗簽，不能只讀 header）。Zero Trust 免費方案的人數上限：官方 account limits 頁未列出，一般認知為 50 人——**推論，待查證**；單一商家的管理者人數遠低於此。

部署環境的 Web Worker 只從自訂網域對外（production `holdfast.gravito.dev`、preview `holdfast-preview.gravito.dev`），並關閉 workers.dev：官方文件只描述 Access 保護「一個 Worker 的 workers.dev URL」整體，未提及路徑層級——**推論**無法只保護 `/admin` 而不擋住公開頁；而留著 workers.dev 等於留一個繞過 Access 的入口。Access 以 self-hosted application 只保護兩個網域的 `/admin` 路徑。


preview 與 production 刻意共用同一個 Access application，因此共用同一個 AUD：在 preview 取得的管理者 JWT 在 production 同樣有效。preview 可從任意分支部署，惡意分支因此能截取管理者在 preview 的 JWT 並對 production 重放。目前 repo 只有擁有者有寫入權限，這個風險被接受；有協作者時，應拆成兩個 application、各自一個 AUD。

**Falsified if:** 管理者需要 Access 無法表達的權限分級（`CONTEXT.md` 的「管理者」不再是單一角色），或 Access 免費方案條款改變。
