# 玩弄文字於指尖

輸入文字後，字句會像繩子一樣掛在手指上。單手時五條文字繩會掛在手指肚附近並向兩側下垂，前後兩段會依手掌朝向左右錯開、以前亮後暗呈現深度；雙手同時入鏡時，文字繩會連接兩手對應指尖，並隨手部移動產生晃動與下垂弧線。

右側參數面板可調整文字大小、顏色、字體粗細、緊密度與重力。字重會直接套用到 Canvas 字型；重力會影響 Verlet 節點積分，數值越高下垂與甩動越明顯。

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

前後遮擋使用 MediaPipe 手指深度、手掌朝向與 2D 距離做近似判斷。單手彎折處會畫在手指上方，後段文字較暗且可能被自己的手指遮住。Webcam 沒有精準去背資料，因此手指擋住文字的效果會依光線、手勢與模型偵測穩定度而有差異。

單手模式只固定文字繩中段，兩端保持自由；雙手模式固定頭尾兩端。這讓單手看起來像文字掛在手指上，雙手則像拉起一條可晃動的文字繩。

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
