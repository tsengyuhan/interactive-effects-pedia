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
//   hasParams: true,            // 是否有可調參數面板
//   why: "靈感/想法的一段文字",      // 可省略
//   references: [                    // 可省略，參考連結
//     { label: "顯示文字", url: "https://..." }
//   ]
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
    description: "對著鏡頭與麥克風發聲，畫面會像湖面倒影般盪開漣漪，可切換 2D Canvas／WebGL 兩種渲染",
    instructions: "面對鏡頭，對麥克風說話、拍手或哼聲；每次起音會投入一滴水，聲音越大漣漪越大，音高越高落點越靠上方",
    tech: ["Web Audio API", "getUserMedia", "Canvas 2D", "WebGL", "GLSL", "高度場水波模擬"],
    principle: [
      "麥克風訊號經 AnalyserNode 取出波形，算 RMS 得音量，自相關法估音高",
      "鏡頭畫面作為水面倒影，漣漪以高度場梯度對畫面做折射位移，輸出可在 2D Canvas 與 WebGL shader 間切換",
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
    id: "genesis-finger",
    title: "創世紀手指",
    category: "身體動作",
    description: "對著鏡頭伸出手，畫面從對角對側伸出一隻手，越往中間靠近，最後兩隻食指指尖相觸，像《創世紀》那幅畫；對面的手畫在你前面，也可改用自己拍下去背的「神之手」",
    instructions: "面對鏡頭伸出手；webcam 做人像去背、疊在純色背景上。當你的手越往畫面中央移動，對面就從「對角對側」伸出一隻手越靠近你，最後兩隻食指指尖相碰（你的手往上伸，對面的手就從上往下伸），且畫在你的前面；相觸停留越久，指尖交會處的火光越亮。對面的手每次隨機是五種風格之一（文藝復興壁畫、卡通、貓掌、機器人、外星人），也可改用你自己的「神之手」。點上方「✋ 創造神之手」可拍下自己的手、自動去背只留手，預覽時用筆刷擦除殘留／補回缺角，確認後對面就換成你的手（反悔按取消）。可調手的大小、最多互動手的數量、圖片手來源（內建五種／我的神之手）",
    tech: ["MediaPipe Hands", "MediaPipe Image Segmenter", "getUserMedia", "Canvas 2D"],
    principle: [
      "MediaPipe 手部模型即時取得每隻手的食指指尖座標，跨幀以最近鄰配對維持身分與隨機風格；對面的手畫在使用者前面",
      "即時畫面用人像分割模型做「整個人」去背，疊在純色背景上",
      "以畫面中央為對稱點，對面的手永遠在使用者手的對角對側、朝中央伸來，靠指尖到中央的距離換算接近度，相觸於使用者指尖；相觸停留越久，指尖交會處的火光越亮",
      "「創造神之手」：拍下使用者的手後，用人像分割遮罩 ∩ 手部關鍵點手形框去背（只留手、不漏臉），旋轉轉正成統一方位，再讓使用者用筆刷擦除殘留／補回缺角，確認後成為互動的圖片手"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true,
    why: "看到一張《創世紀》的圖，聯想到現在科技把各種人與資訊連在一起——觸碰的點很小，後續的發展卻無法預期。",
    references: [
      { label: "創世紀手指 參考圖 1", url: "https://fr.pinterest.com/pin/790592909628866724/" },
      { label: "創世紀手指 參考圖 2", url: "https://fr.pinterest.com/pin/790592909628866731/" },
      { label: "創世紀手指 參考圖 3", url: "https://fr.pinterest.com/pin/962574120343565841/" }
    ]
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
      "繩子用時間修正(dt)的 Verlet 物理，不同 fps 手感一致；繩長剛性，甩動的彎曲拖尾來自慣性",
      "單人繩硬釘鼻尖、自由垂掛；甩動誇張度把頭部速度平滑放大去驅動固定端，逐節延遲產生鞭狀拖尾",
      "每個人找最靠近的另一個人，距離在門檻內就連線；雙人繩兩端釘頭頂、受重力下垂成弧，文字沿繩流動",
      "兩人拉遠超過最遠連接距離，連接繩斷開、變回各自的單人繩"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true
  },
  {
    id: "cut-the-world",
    title: "手指切割世界",
    category: "身體動作",
    description: "伸出食指在鏡頭畫面上畫一個封閉形狀，那塊世界會發光掉落，洞裡露出套用特效的虛擬空間",
    instructions: "面對鏡頭，伸出食指、收起中指與無名指，停住約半秒，指尖發光後就能在空中畫一個封閉形狀；路徑閉合後發光 1 秒，那塊畫面便掉落，碎片會互相碰撞彈跳、堆在畫面底部約 8 秒後淡出；洞裡透出套用特效的即時畫面。可連續切好幾刀，洞會累積、重疊的洞會合併成更大的洞，按右上角「重置世界」復原。可選洞內特效（科技像素／動態亂碼／印刷拼貼／色塊版畫），並調整特效顆粒、洞緣厚度與掉落速度",
    tech: ["MediaPipe Hands", "getUserMedia", "Canvas 2D", "Matter.js", "polygon-clipping"],
    principle: [
      "MediaPipe 手部模型即時取得食指指尖座標，以指節距離判定「只伸食指」手勢，維持半秒確認後才開始記錄軌跡",
      "軌跡自我相交或首尾靠近即形成封閉多邊形，發光一秒後把該區畫面快照成碎片",
      "碎片以凸包剛體交給 Matter.js 模擬：依形狀翻倒、彈跳、堆疊，支撐消失自動掉落，落定 8 秒後淡出；重疊的洞自動聯集，洞緣取畫面色壓暗畫出牆體斷面與內陰影做出厚度，透出特效版即時畫面",
      "四種特效以低解析度取樣重繪，亮度自動對比拉伸：像素量化、字雨（移動閃白）、半調網點、版畫平塗"
    ],
    requirements: ["攝影機", "建議 Chrome / Edge", "舊機器 fps 較低", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true,
    why: "探索螢幕後面的虛擬空間，平面的螢幕後可能有著無限的空間。",
    references: [
      { label: "切割世界 參考圖 1（動態亂碼）", url: "https://fr.pinterest.com/pin/790592909629265590/" },
      { label: "切割世界 參考圖 2（科技像素）", url: "https://fr.pinterest.com/pin/790592909629265605/" },
      { label: "切割世界 參考圖 3（印刷拼貼）", url: "https://fr.pinterest.com/pin/790592909629265577/" },
      { label: "切割世界 參考圖 4（色塊版畫）", url: "https://fr.pinterest.com/pin/918804761449747082/" }
    ]
  },
  {
    id: "crystal-lens",
    title: "放大鏡",
    category: "網頁互動",
    description: "一顆玻璃透鏡跟著滑鼠在 webcam 畫面上滑動，可切換放大鏡、一般玻璃、毛玻璃三種鏡片",
    instructions: "面對鏡頭並移動滑鼠（或手指拖曳），玻璃透鏡會平滑跟著游標；可切換鏡片模式，並調整鏡片大小、放大倍率、折射扭曲、邊緣色散、邊緣高光與毛玻璃模糊",
    tech: ["WebGL", "GLSL", "getUserMedia"],
    principle: [
      "webcam 畫面上傳成 WebGL 紋理，整個畫面交給 fragment shader 逐像素重算",
      "透鏡內把取樣座標往鏡心縮放做出放大，越靠邊緣偏移越大，模擬厚玻璃折射",
      "RGB 三色用略微不同的縮放取樣，邊緣出現彩虹色散；再疊上弧形高光、邊緣壓暗與外圈落影做出玻璃厚度",
      "毛玻璃用黃金角螺旋多點取樣平均成模糊，再混入一點白霧"
    ],
    requirements: ["攝影機", "支援 WebGL 的瀏覽器（建議 Chrome / Edge）", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true,
    why: "測試網頁可以製作什麼樣的玻璃效果。",
    references: [
      { label: "Crystal Lens Cursor（Brik）", url: "https://brik.space/ToolViewer?slug=crystal-lens-cursor-mr870uvt" }
    ]
  },
  {
    id: "sound-firework",
    title: "聲音煙火",
    category: "聲音互動",
    description: "對麥克風發聲或打鼓，畫面下方就發射一顆寫實貓咪頭，飛到最高點時綻放成油畫筆觸的煙火",
    instructions: "對著麥克風打鼓、拍手或發聲；每個鼓點會隨機射出一隻貓（橘虎斑、賓士、布偶、暹羅），一路變大並逐格演出牠的專屬動作，到頂點時炸開成放射狀筆觸。可調觸發音量、煙火大小與顏色",
    tech: ["Web Audio API", "getUserMedia", "Canvas 2D", "逐格動畫"],
    principle: [
      "麥克風波形算 RMS 得音量，只在跨過門檻的起音瞬間發射，90 毫秒不應期讓鼓點能連發",
      "頻譜重心代表聲音明亮度，決定貓咪飛到多高；音量決定貓咪大小與炸開的筆觸數量",
      "整套模擬固定跑 12 fps，四隻寫實貓各有一套 6 格序列圖，依飛行進度換格做出逐格動畫的頓挫感",
      "夜空與火星都用筆刷畫：夜空是方頭粗筆疊塗，火星是三根鬃毛的乾筆長筆觸，殘筆再淡回夜空"
    ],
    requirements: ["麥克風", "建議 Chrome / Edge", "無特殊效能需求", "需經 start.bat 或 HTTPS 開啟"],
    offline: true,
    offlineNote: "",
    hasParams: true,
    why: "最近在學打鼓，想要有個可以互動的視覺。",
    references: [
      { label: "煙火參考圖 1", url: "https://fr.pinterest.com/pin/178173729000520074/" },
      { label: "煙火參考圖 2", url: "https://fr.pinterest.com/pin/403987029090671273/" },
      { label: "煙火參考圖 3", url: "https://fr.pinterest.com/pin/76068681196300218/" }
    ]
  }
];
