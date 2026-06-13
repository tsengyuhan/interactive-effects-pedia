# 玩弄文字於指尖

輸入文字後，字句會跟著手部變成可操控的動態線條。單手時，每根手指都有一串字粒從手腕端持續爬向指尖，越過指尖後向下垂掛，最後在底部淡出；雙手同時入鏡時，文字繩會連接兩手對應指尖，並隨手部移動產生晃動與下垂弧線。

右側參數面板可調整文字大小、顏色、字體粗細、緊密度與重力。緊密度會影響單手字粒間距；重力會微調單手垂掛段擺動，並影響雙手 Verlet 節點積分。

## 主要技術

- MediaPipe Hands
- getUserMedia
- Canvas 2D
- Verlet 物理

## 需求

- 攝影機
- 建議 Chrome / Edge
- 舊機器 fps 較低
- 需經 `start.bat` 或 HTTPS 開啟
- 可離線使用

## 注意事項

手上路徑的遮擋使用 MediaPipe 手指深度與 2D 距離做近似判斷；垂掛段不做遮擋。Webcam 沒有精準去背資料，因此手指擋住文字的效果會依光線、手勢與模型偵測穩定度而有差異。

單手模式以每根手指的手腕到指尖折線作為字粒路徑，指尖後方接一段向下垂掛的淡出區。雙手模式固定頭尾兩端，保留可晃動的文字繩。

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 啟動方式：
   - 雙擊專案根目錄的 `start.bat`
   - 瀏覽器開 `http://localhost:8080/effects/text-ropes/`
3. 這個效果需要攝影機權限，必須用 `start.bat` 啟動，或透過 HTTPS 開啟。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/text-ropes/
