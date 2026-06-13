# 聲音漣漪

對著鏡頭與麥克風發聲，畫面會像湖面倒影般盪開漣漪。面對鏡頭，對麥克風說話、拍手或哼聲；每次起音會投入一滴水，聲音越大漣漪越大，音高越高落點越靠上方。

## 主要技術

- Web Audio API
- getUserMedia
- Canvas 2D
- 高度場水波模擬

## 需求

- 攝影機
- 麥克風
- 建議 Chrome / Edge
- 需經 `start.bat` 或 HTTPS 開啟
- 可離線使用

## 在自己電腦使用

1. 下載整個專案：
   - `git clone https://github.com/tsengyuhan/interactive-effects-pedia.git`
   - 或在 GitHub 頁面 Download ZIP 後解壓
2. 啟動方式：
   - 雙擊專案根目錄的 `start.bat`
   - 瀏覽器開 `http://localhost:8080/effects/sound-ripple/`
3. 這個效果需要攝影機與麥克風權限，必須用 `start.bat` 啟動，或透過 HTTPS 開啟。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/sound-ripple/
