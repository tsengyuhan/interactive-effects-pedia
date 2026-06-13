# 互動效果百科

互動效果百科是一個純靜態、零建置、可離線執行的互動網頁效果展示網站。每個效果獨立放在 `effects/` 內，首頁與效果頁共用中央登錄檔 `effects/effects.js`。

## 線上網址

（部署後補上）

## 本機使用

- 雙擊 `start.bat`，以 `http://localhost:8080/` 開啟完整網站。
- 需要攝影機或麥克風的效果請使用 `start.bat`，因為瀏覽器通常要求 localhost 或 HTTPS 才能取得權限。
- 純滑鼠效果可直接開啟 `index.html` 使用。

## 新增效果

1. 複製 `templates/新增效果需求.md`，填寫新效果需求。
2. 依 `新增效果SOP.md` 建立效果資料夾、效果程式、登錄資料與縮圖。
3. 新增第三方函式庫時必須下載到 `libs/`，禁用 CDN。

## 目錄結構

- `index.html`：首頁。
- `assets/`：首頁與效果頁共用樣式、外殼程式。
- `effects/`：各互動效果與中央登錄檔。
- `libs/`：離線第三方函式庫與模型。
- `templates/`：新增效果需求模板。
- `docs/superpowers/specs/2026-06-13-互動效果百科-design.md`：設計規格文件。
