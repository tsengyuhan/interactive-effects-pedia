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
    description: "在宣紙上長按拖曳，畫出會暈染的水墨筆畫",
    instructions: "按住滑鼠（或手指）在畫布上拖曳；停留越久墨暈越開，快速劃過會出現飛白",
    tech: ["Canvas 2D"],
    principle: [
      "用程式雜訊產生宣紙紋理當底",
      "筆畫由連續蓋印的半透明墨點組成，移動速度決定墨點的濃淡與密度",
      "落筆處登記為「暈染點」，逐幀向外擴張、透明度遞減，模擬墨水滲入紙纖維"
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
    description: "對著麥克風發出聲音，池塘水面會泛起大小與餘波不同的漣漪",
    instructions: "對麥克風說話、拍手或哼聲；聲音越大漣漪越大，音高決定餘波長短",
    tech: ["Web Audio API", "Canvas 2D", "高度場水波模擬"],
    principle: [
      "麥克風訊號經 AnalyserNode 取出波形，算 RMS 得音量，自相關法估音高",
      "水面是一張高度場網格，每幀由鄰格高度差傳遞波動，自然產生干涉與反彈",
      "音量決定投入水面的能量（漣漪大小），音高調整衰減率（餘波長短）"
    ],
    requirements: ["麥克風", "建議 Chrome / Edge", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: false
  },
  {
    id: "_smoke",
    title: "外殼煙霧測試",
    category: "網頁互動",
    description: "驗證共用外殼、資訊面板、參數與錯誤蓋版是否正常運作",
    instructions: "移動滑鼠或手指觀察圓形位置；調整半徑與顏色後會即時套用",
    tech: ["Canvas 2D", "Shell API"],
    principle: [
      "共用外殼從中央登錄檔讀取效果資料並建立資訊面板",
      "效果程式只負責畫面與互動，參數控制交給 Shell API 注入"
    ],
    requirements: ["滑鼠或觸控螢幕", "任何現代瀏覽器"],
    offline: true,
    offlineNote: "",
    hasParams: true
  }
];
