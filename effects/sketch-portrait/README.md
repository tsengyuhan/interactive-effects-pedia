# 草稿紙人像

webcam 把人從背景切出來後，畫在一張方格稿紙上：人像區域依明暗用鉛筆交叉線塗陰影，越暗的格子線條疊得越密，慢慢「畫」出你的輪廓。背景則留白。

在畫面上按住格線往左右或上下拖曳，稿紙會沿著那條線撕開一條縫，露出底下真實的鏡頭畫面，放開後縫會自動闔上——像把稿紙拉開偷看真實的你。

開啟時會先顯示相機與模型載入提示，畫面就緒後自動收起。

## 主要技術

- MediaPipe Image Segmenter（人像去背）
- getUserMedia
- Canvas 2D

## 可調參數

- 格子大小：稿紙方格邊長，也決定人像的解析度（格子越小越細緻、越吃效能）
- 線條濃度：整體鉛筆陰影的濃淡

## 需求

- 攝影機
- 建議 Chrome / Edge
- 舊機器 fps 較低（格子調大可提升流暢度）
- 需經 `start.bat` 或 HTTPS 開啟
- 可離線使用

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 啟動方式：
   - 雙擊專案根目錄的 `start.bat`
   - 瀏覽器開 `http://localhost:8080/effects/sketch-portrait/`
3. 這個效果需要攝影機權限，必須用 `start.bat` 啟動，或透過 HTTPS 開啟。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/sketch-portrait/
