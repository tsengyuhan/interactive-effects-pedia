# 玩弄文字於指尖

輸入文字後，字句會跟著手部變成可操控的動態線條。單手時，五條文字繩分別固定在五個指尖，另一端自然垂下並隨手部移動甩動；雙手同時入鏡時，文字繩會連接兩手對應指尖，並隨手部移動產生晃動與下垂弧線。

右側參數面板可調整顯示模式、文字大小、字體粗細、顏色、緊密度、文字繩長度與重力。顯示模式預設為完整 webcam；切換到純手部模式時，畫面會改成天空藍背景，只保留到手腕為止的手並加上撕紙白邊。緊密度會影響文字沿繩排列的距離；文字繩長度控制單手垂釣長度；重力會影響 Verlet 節點積分。

## 主要技術

- MediaPipe Hands
- MediaPipe Image Segmenter
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

手上路徑的遮擋使用 MediaPipe 手指深度與 2D 距離做近似判斷。Webcam 沒有精準去背資料，因此手指擋住文字的效果會依光線、手勢與模型偵測穩定度而有差異。

純手部模式的去背＝「landmark 手形」∩「人像分割」∩「手腕切線」三者交集。手腕切線負責切掉前臂，其錨點會參考拇指根/魚際（landmark 1、2）的位置，避免手背朝鏡頭或往側邊轉時把手背切掉一塊。極端角度（手幾乎側轉、拇指根投影遠落在手腕後方）仍可能殘留輕微缺角，屬已知限制。

單手模式固定每條繩的指尖端，另一端自由受重力垂下，手指移動時會靠慣性甩動。雙手模式固定頭尾兩端，保留可晃動的文字繩。

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
