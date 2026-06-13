// 中央登錄檔——首頁與效果頁的唯一資料來源
// 用 .js 而非 .json：file:// 直接開啟時 fetch JSON 會被瀏覽器擋下，JS 檔不受限
//
// 欄位契約：
// {
//   id: "ink-brush",            // 資料夾名稱（slug，小寫連字號）
//   title: "水墨筆觸",           // 效果名稱
//   category: "網頁互動",        // 網頁互動｜身體動作｜聲音互動（可新增）
//   description: "一句話描述",
//   instructions: "操作說明，一兩句",
//   tech: ["Canvas 2D"],        // 主要使用技術標籤
//   principle: ["條列1", "條列2"], // 白話原理，總計 200 字內
//   requirements: ["滑鼠或觸控", "任何現代瀏覽器"], // 軟硬體規格
//   offline: true,              // false 時必填 offlineNote
//   offlineNote: "",
//   hasParams: true             // 是否有可調參數面板
// }
window.EFFECTS = [
  {
    id: "ink-brush",
    title: "水墨筆觸",
    category: "網頁互動",
    description: "在宣紙上長按拖曳，畫出連貫且會暈染的水墨筆畫",
    instructions: "按住滑鼠（或手指）在畫布上拖曳；停留越久墨暈越開，快速劃過時筆畫會變細並帶出飛白",
    tech: ["Canvas 2D"],
    principle: [
      "用程式雜訊產生宣紙紋理當底",
      "拖曳時用平滑曲線連續描邊，筆刷大小、濃度與移動速度共同決定線寬和透明度",
      "落筆處登記為「暈染點」，以多個偏移子瓣柔和擴張，模擬墨水滲入紙纖維"
    ],
    requirements: ["滑鼠或觸控螢幕", "任何現代瀏覽器", "無特殊效能需求"],
    offline: true,
    offlineNote: "",
    hasParams: true
  },
  {
    id: "finger-frame",
    title: "手指取景框",
    category: "身體動作",
    description: "雙手比 L 字框出一個取景框，框內畫面即時變成負片或馬賽克",
    instructions: "面對鏡頭，雙手各比出 L 字手勢（拇指與食指張開約 90 度），兩手的虎口會撐出一個取景框",
    tech: ["MediaPipe Hands", "getUserMedia", "Canvas 2D"],
    principle: [
      "MediaPipe 手部模型即時輸出每隻手 21 個關節點座標",
      "計算拇指與食指向量的夾角，接近 90 度即判定為 L 手勢",
      "取兩手虎口位置為矩形對角，框內像素逐格重算（負片＝反相、馬賽克＝區塊取樣色）"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器約 15–25 fps，新機器可達 30 fps 以上", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  },
  {
    id: "sound-ripple",
    title: "聲音漣漪",
    category: "聲音互動",
    description: "對著鏡頭與麥克風發聲，畫面會像湖面倒影般盪開漣漪",
    instructions: "面對鏡頭，對麥克風說話、拍手或哼聲；每次起音會投入一滴水，聲音越大漣漪越大，音高越高落點越靠上方",
    tech: ["Web Audio API", "getUserMedia", "Canvas 2D", "高度場水波模擬"],
    principle: [
      "麥克風訊號經 AnalyserNode 取出波形，算 RMS 得音量，自相關法估音高",
      "鏡頭畫面作為水面倒影，漣漪以高度場梯度對畫面做折射位移",
      "音量只在跨過門檻的起音瞬間投滴，音量決定能量，音高調整落點高度與衰減率"
    ],
    requirements: ["攝影機", "麥克風", "建議 Chrome / Edge", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  },
  {
    id: "text-ropes",
    title: "玩弄文字於指尖",
    category: "身體動作",
    description: "輸入文字，文字像繩子般垂掛、纏繞並連接你的手指",
    instructions: "在上方輸入文字；單手時文字繩從指尖垂下，雙手時連接兩手對應手指，隨手晃動",
    tech: ["MediaPipe Hands", "getUserMedia", "Canvas 2D", "Verlet 物理"],
    principle: [
      "MediaPipe 手部模型即時取得五根指尖位置與深度",
      "每條文字繩由多個 Verlet 節點組成，固定端跟隨指尖，重力與距離約束產生下垂和甩動",
      "沿繩子弧長循環排字，並用手指深度近似判斷前後遮擋"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  }
];
