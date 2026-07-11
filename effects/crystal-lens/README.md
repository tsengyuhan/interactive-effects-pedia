# 放大鏡

一顆玻璃透鏡跟著滑鼠在 webcam 畫面上滑動。面對鏡頭並移動滑鼠（或手指拖曳），透鏡會平滑跟著游標；可切換「放大鏡／一般玻璃／毛玻璃」三種鏡片，並調整鏡片大小、放大倍率、折射扭曲、邊緣色散、邊緣高光與毛玻璃模糊。

開啟時會先顯示相機載入提示，等攝影機畫面就緒後自動收起。

## 主要技術

- WebGL
- GLSL
- getUserMedia

## 需求

- 攝影機
- 支援 WebGL 的瀏覽器（建議 Chrome / Edge）
- 需經 `start.bat` 或 HTTPS 開啟
- 可離線使用

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 啟動方式：
   - 雙擊專案根目錄的 `start.bat`
   - 瀏覽器開 `http://localhost:8080/effects/crystal-lens/`
3. 這個效果需要攝影機權限，必須用 `start.bat` 啟動，或透過 HTTPS 開啟。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/crystal-lens/
