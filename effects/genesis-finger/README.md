# 創世紀手指

伸出你的手，與未知之手互動。使用者對著鏡頭伸出手；畫面對面會伸出一隻「圖片手」，當使用者的手越往畫面中央移動，對面的手就越靠近，最後兩隻食指指尖相觸，像米開朗基羅《創世紀》那幅畫。手離開畫面，對面的手也會收回。畫面中越多手，就出現越多對面的手（最多依參數設定）。

視覺上，Webcam 畫面會進行去背，疊在土黃色歷史感牆壁背景上；對面的手每次隨機出現五種風格之一（文藝復興壁畫手、卡通手、貓掌、機器人手、外星人手）。

右側參數面板可調整去背模式（只露出手／整個人）、手的大小，以及最多可互動手的數量（1–4）。

## 主要技術

- MediaPipe Hands（手部關鍵點）
- MediaPipe Image Segmenter（人像去背）
- getUserMedia
- Canvas 2D

## 需求

- 攝影機
- 建議 Chrome / Edge
- 舊機器 fps 較低
- 需經 `start.bat` 或 HTTPS 開啟（file:// 無法使用）
- 可離線使用（模型與素材都在本地）

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 啟動方式：
   - 雙擊專案根目錄的 `start.bat`
   - 瀏覽器開 `http://localhost:8080/effects/genesis-finger/`
3. 這個效果需要攝影機權限，必須用 `start.bat` 啟動，或透過 HTTPS 開啟。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/genesis-finger/
