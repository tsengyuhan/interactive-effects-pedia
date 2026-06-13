# 手指取景框

雙手比 L 字框出一個取景框，框內畫面即時變成負片或馬賽克。面對鏡頭，雙手各比出 L 字手勢（拇指與食指張開約 90 度），兩手的虎口會撐出一個取景框。

## 主要技術

- MediaPipe Hands
- getUserMedia
- Canvas 2D

## 需求

- 攝影機
- 建議 Chrome / Edge
- 舊機器約 15-25 fps，新機器可達 30 fps 以上
- 需經 `start.bat` 或 HTTPS 開啟
- 可離線使用

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 啟動方式：
   - 雙擊專案根目錄的 `start.bat`
   - 瀏覽器開 `http://localhost:8080/effects/finger-frame/`
3. 這個效果需要攝影機權限，必須用 `start.bat` 啟動，或透過 HTTPS 開啟。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/finger-frame/
