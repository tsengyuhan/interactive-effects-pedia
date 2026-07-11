# 手指切割世界

伸出食指在鏡頭畫面上畫一個封閉形狀，切下的畫面會發光、掉落，碎片互相碰撞彈跳、堆在畫面底部一陣子後淡出，洞裡露出套用即時特效的虛擬空間。洞可以持續累積，也能隨時重置。

## 主要技術

- MediaPipe Hands
- getUserMedia
- Canvas 2D
- Matter.js（碎片剛體物理）

## 需求

- 攝影機
- 建議 Chrome / Edge
- 舊機器 fps 較低
- 需經 `start.bat` 或 HTTPS 開啟
- 可離線使用

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 雙擊專案根目錄的 `start.bat`。
3. 開啟 `http://localhost:8080/effects/cut-the-world/`。
4. 允許攝影機權限，伸出食指並收起中指、無名指，停住約半秒待指尖發光後，在空中畫出封閉形狀。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/cut-the-world/
