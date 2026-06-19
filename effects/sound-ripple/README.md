# 聲音漣漪

對著鏡頭與麥克風發聲，畫面會像湖面倒影般盪開漣漪。面對鏡頭，對麥克風說話、拍手或哼聲；每次起音會投入一滴水，聲音越大漣漪越大，音高越高落點越靠上方。

## 主要技術

- Web Audio API
- getUserMedia
- Canvas 2D
- WebGL / GLSL
- 高度場水波模擬

參數面板可切換「2D Canvas」與「WebGL」渲染模式；兩者共用同一套聲音分析與高度場水波模擬，只替換最後的畫面輸出管線。

## 兩種渲染模式比較

同一條折射＋打光公式，差別只在「誰來算」：

- **2D Canvas（CPU 串列）**：JS 迴圈逐像素計算、`putImageData` 輸出。優點是直覺、好除錯、相容性最好、無前置成本；缺點是像素一多就佔用主執行緒、容易掉幀。
- **WebGL（GPU 平行）**：fragment shader 上千核心同時算每個像素。優點是逐像素運算近乎免費、畫面越大越複雜越划算、主執行緒更穩；缺點是程式較複雜（context／shader／texture／Y 軸方向都要顧）、依賴 GPU 與 `OES_texture_float` 擴充、有建 context 與上傳 texture 的固定開銷。

目前在輕量設定下（`water.scale = 2` 只算 1/4 像素、模擬與高度場打包仍在 CPU）兩者效能打平、畫面一致，WebGL 是為日後加重預留的升級空間。

## 未來可嘗試方向

- 把水波模擬本身（`simulateWater`）也搬進 shader（ping-pong framebuffer），讓 CPU 幾乎只處理聲音，WebGL 差距才會真正拉開。
- 將 `water.scale` 調為 1（全解析度）或拉到全螢幕大尺寸，壓力測試兩模式差距。
- 在 WebGL 模式疊加更重的水面特效（反射、焦散、模糊），這類效果在 shader 內幾乎只是加幾行。
- 加上 FPS 顯示，量化比較兩模式在重負載下的表現。

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
