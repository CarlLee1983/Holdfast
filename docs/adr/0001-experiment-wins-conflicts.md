---
status: accepted
---

# 產品與實驗衝突時，以驗證 Cloudflare 行為為準

Holdfast 同時是一個要能上線的訂位服務，也是 [WebForge](https://github.com/CarlLee1983/WebForge) 用來實測 Cloudflare 原生架構的來源專案。兩個目的衝突時——例如某個平台限制可以靠換掉 Cloudflare 元件繞開，但繞開就失去實測價值——以驗證為準：正面碰上限制並記錄結果，而不是繞開它。訂位題目必須夠真實，驗證結論才可信，所以產品面不是可以犧牲的裝飾，只是在衝突時讓位。

**Falsified if:** Holdfast 開始承載真實商家的營收，或 WebForge 不再需要它作為 Cloudflare 來源專案（`README.md` 的「與 WebForge 的關係」段落被移除或改寫）。
