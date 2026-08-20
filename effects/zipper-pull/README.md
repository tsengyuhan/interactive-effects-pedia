# 拉拉鍊

按住寫實牛仔褲或皮革包包上的拉鍊頭拖曳（牛仔褲上下、包包左右），拉鍊沿著 AI 生成的連續幀自然打開（布料皺褶真實），開口露出本地趣圖、迷因動圖或高公局即時監視器畫面。拉回閉合後，下次拉開會換一個內容。

## 操作方式

- 用滑鼠或觸控按住拉鍊頭，沿拉鍊方向拖曳：牛仔褲上下、包包左右。拖曳時會發出拉鍊聲，慢拉聽得到一顆顆齒、快拉連成「滋」一聲。
- 可切換牛仔褲／包包，以及本地趣圖、迷因動圖、即時監視器或隨機混合來源。
- 手勢模式開啟後，以食指指尖當游標：游標靠近拉鍊頭會亮黃框（可抓），捏合抓住後變實心黃點，張開手指放開；捏著移進拉鍊頭附近也能直接抓住。

## 主要技術

- AI 生成連續開拉鍊幀（WebP 含 alpha 開口），Canvas 2D 依進度交叉淡化
- Pointer Events（開口尖點逐段反查，拉鍊頭精準跟手）
- MediaPipe Hands 與 getUserMedia（手勢模式）
- DOM `<img>` 播放 GIF 與 MJPEG，GIF 背景預抓
- Web Audio 循環取樣，`playbackRate` 跟著拉動速度變化

## 音效授權

`assets/zip-loop.wav` 取自 [BigSoundBank「Zip #7」](https://bigsoundbank.com/zip-7-s1862.html)（作者 Joseph SARDIN，CC0 公有領域，免署名），截取其中穩定段並做成 1 秒無縫循環。

## 需求

- 滑鼠或觸控螢幕；手勢模式另需攝影機
- 建議 Chrome / Edge
- 手勢模式需經 `start.bat` 或 HTTPS 開啟
- 本地趣圖可離線使用；動圖與監視器需網路，失敗會自動退回本地圖包

## 在自己電腦使用

1. 下載整個專案。
2. 雙擊專案根目錄的 `start.bat`。
3. 開啟 `http://localhost:8080/effects/zipper-pull/`。

## 線上體驗

https://tsengyuhan.github.io/interactive-effects-pedia/effects/zipper-pull/
