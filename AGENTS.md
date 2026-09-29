# AGENTS.md

給在這個倉庫工作的 coding agent。人類的入口是 [README.md](README.md)。

## 現在的階段

Holdfast 還在決策階段：只有文件，沒有程式碼。架構與技術選型由 `/grill-with-docs` 產出 `CONTEXT.md` 與 `docs/adr/`，
定案之後才加入程式碼與部署設定。

開始工作時，如果 `docs/adr/` 已存在，先讀它並回報目前還是 `proposed` 的決策。

## 證據

關於 Cloudflare 平台行為的主張（D1、Queues、Service Binding、Workers 的限制與語意），
寫進 ADR 前要查過官方文件或實測，引用時寫明是**已驗證**還是**推論**。

## 文件的單一來源

- `CONTEXT.md` 只放詞彙定義，不放決策
- 決策與理由放 `docs/adr/`，其他文件連結過去，不重述取捨
