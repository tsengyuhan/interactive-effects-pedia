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
    description: "輸入文字，單手時五條文字繩從指尖垂下，雙手時連接兩手對應指尖，可切換純手部拼貼畫面",
    instructions: "在上方輸入文字；可調整顯示模式、字體大小、粗細、顏色、緊密度、文字繩長度與重力。純手部模式會移除整片 webcam 背景，只保留到手腕的手與撕紙白邊。單手時文字繩從五指尖垂下並隨手晃動；雙手時文字繩會連接兩手對應指尖",
    tech: ["MediaPipe Hands", "MediaPipe Image Segmenter", "getUserMedia", "Canvas 2D", "Verlet 物理"],
    principle: [
      "MediaPipe 手部模型即時取得五個指尖座標",
      "純手部模式用內建人像分割模型，配合手部關鍵點描出的手形與手腕切線，裁出到手腕為止的手並加上撕紙白邊",
      "單手時每個指尖固定一條 Verlet 文字繩，另一端受重力自然垂下並保留甩動慣性",
      "雙手時固定兩手對應指尖，靠節點距離約束產生連接兩手的文字繩"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  },
  {
    id: "sketch-portrait",
    title: "草稿紙人像",
    category: "身體動作",
    description: "webcam 把人去背後畫在綠色作文稿紙上，可用鉛筆排線或循環文字排出人像；拖曳格線把稿紙撕開一條縫，縫內切換成連續鉛筆素描",
    instructions: "面對鏡頭，人像會以鉛筆塗法畫滿稿紙格子；可切到文字模式並輸入繁中文字，暗部格子會改由循環文字組成人像。在畫面上按住格線往左右或上下拖曳，稿紙會沿那條線撕開一條縫（拖曳點最寬、往兩端漸收），縫內變成同一個人的連續細緻素描，放開後自動闔上。可調整繪製模式、格子大小與線條濃度",
    tech: ["MediaPipe Image Segmenter", "getUserMedia", "Canvas 2D"],
    principle: [
      "人像分割模型即時把人從背景切出，只有人的區域會被作畫",
      "畫面縮到格子解析度取每格明暗，越暗的格子鉛筆塗得越濃；文字模式則用本地手寫字型依明暗填入循環文字",
      "撕縫處用 raised-cosine 把格線兩側往外推開（拖曳點最寬、兩端漸收），縫內改用連續素描濾鏡畫同一個人"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  },
  {
    id: "text-rope-link",
    title: "文字繩連連看",
    category: "身體動作",
    description: "輸入文字，單人時文字繩一端黏在鼻子上、另一端自由垂下隨頭甩動；多人時連接最靠近的兩顆頭、受重力下垂成弧且文字沿繩流動，距離太遠會斷開",
    instructions: "面對鏡頭並輸入文字。只有你一人時，文字繩一端黏在你的鼻子上、另一端柔軟自由垂下，會隨著頭移動而晃動（可調甩動誇張度做出甩鼻涕般效果）；出現其他人時，文字繩會連到最靠近你的人的頭頂、受重力在中間下垂成弧、文字沿繩流動，超過最遠連接距離就斷開成各自垂下的繩。可調文字大小、疏密、粗細、顏色、最遠連接距離、重力、單人繩長度、晃動柔軟度、甩動誇張度與雙人文字流動速度",
    tech: ["MediaPipe Face Detector", "getUserMedia", "Canvas 2D", "Verlet 物理"],
    principle: [
      "FaceDetector 即時偵測每個人的頭部與鼻尖關鍵點，跨幀以最近鄰配對維持身分、並帶速度預測減少延遲",
      "單人繩只硬釘鼻尖、其餘節點自由垂掛（同雙手指尖繩作法）；錨點可依頭速超前做出誇張甩動",
      "每個人找最靠近的另一個人，距離在門檻內就連線；雙人繩兩端釘頭頂、受重力下垂成弧，文字沿繩流動",
      "兩人拉遠超過最遠連接距離，連接繩斷開、變回各自的單人繩"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  }
];
