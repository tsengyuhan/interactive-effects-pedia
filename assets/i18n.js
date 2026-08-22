/* 語言切換：字典直接用中文原文當 key，所以 effects.js 與各效果的資料完全不用動。
   切語言＝存 localStorage 後重新整理，效果本來就是一次性初始化，重載最省事也不會漏翻。 */
(function () {
  "use strict";

  const DICT = {
    /* ── 站台 ─────────────────────────────── */
    "Interactia 網頁互動圖鑑": "Interactia Web Interaction Codex",
    "網頁互動圖鑑": "Web Interaction Codex",
    "各種有趣互動的快速prototype，點即進入體驗，可參考說明與原始碼。":
      "Quick prototypes of playful web interactions. Click one to try it, then dig into the notes and the source.",
    "效果分類": "Effect categories",
    "全部": "All",
    "網頁互動": "Web Interaction",
    "身體動作": "Body Motion",
    "聲音互動": "Sound Interaction",
    "完全離線": "Fully offline",
    "需網路": "Needs internet",
    "尚無效果，敬請期待": "No effects yet — stay tuned",

    /* ── Shell 介面 ───────────────────────── */
    "← 返回": "← Back",
    "開啟資訊面板": "Open info panel",
    "關閉資訊面板": "Close info panel",
    "效果資訊": "Effect info",
    "可調參數": "Parameters",
    "為什麼做這個？": "Why I made this",
    "操作說明": "How to use",
    "原理": "How it works",
    "需求": "Requirements",
    "發生錯誤": "Something went wrong",
    "重新整理": "Reload",
    "載入中…": "Loading…",
    "在 GitHub 查看原始碼": "View source on GitHub",
    "參數": "Parameter",
    "執行": "Run",
    "錯誤": "Error",

    /* ── 共用的效果需求／技術標籤 ─────────── */
    "滑鼠或觸控": "Mouse or touch",
    "滑鼠或觸控螢幕": "Mouse or touchscreen",
    "任何現代瀏覽器": "Any modern browser",
    "無特殊效能需求": "No special performance needs",
    "攝影機": "Webcam",
    "麥克風": "Microphone",
    "建議 Chrome / Edge": "Chrome / Edge recommended",
    "需經 start.bat 或 HTTPS 開啟": "Must be opened via start.bat or HTTPS",
    "舊機器 fps 較低": "Lower fps on older machines",
    "舊機器約 15–25 fps，新機器可達 30 fps 以上":
      "Roughly 15–25 fps on older machines, 30+ fps on newer ones",
    "支援 WebGL 的瀏覽器（建議 Chrome / Edge）": "A WebGL-capable browser (Chrome / Edge recommended)",
    "動圖與監視器來源需網路，離線自動退回本地圖包":
      "GIFs and live camera feeds need internet; offline it falls back to the local image pack",
    "手勢模式需攝影機，經 start.bat 或 HTTPS 開啟":
      "Gesture mode needs a webcam, opened via start.bat or HTTPS",
    "高度場水波模擬": "Height-field water simulation",
    "Verlet 物理": "Verlet physics",
    "逐格動畫": "Frame-by-frame animation",
    "AI 連續幀": "AI frame sequence",
    "正在開啟相機，請稍候…": "Starting the camera…",
    "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動":
      "Allow camera access and reload the page. Opening the file directly won't work — launch it with start.bat instead.",

    /* ── 水墨筆觸 ─────────────────────────── */
    "水墨筆觸": "Ink Brush",
    "在宣紙上長按拖曳，畫出連貫且會暈染的水墨筆畫":
      "Press and drag on rice paper to draw flowing ink strokes that bleed as they settle",
    "按住滑鼠（或手指）在畫布上拖曳；停留越久墨暈越開，快速劃過時筆畫會變細並帶出飛白":
      "Hold the mouse (or a finger) and drag across the canvas. Linger and the ink blooms wider; sweep fast and the stroke thins out into dry-brush streaks.",
    "用程式雜訊產生宣紙紋理當底": "Procedural noise generates the rice-paper texture underneath",
    "拖曳時用平滑曲線連續描邊，筆刷大小、濃度與移動速度共同決定線寬和透明度":
      "Dragging strokes a smooth continuous curve; brush size, density and pointer speed together set line width and opacity",
    "落筆處登記為「暈染點」，以多個偏移子瓣柔和擴張，模擬墨水滲入紙纖維":
      "Each touch registers a bleed point that expands through several offset lobes, mimicking ink soaking into paper fibres",
    "水墨筆觸畫布": "Ink brush canvas",
    "墨色濃度": "Ink density",
    "暈染擴散": "Bleed spread",
    "筆刷大小": "Brush size",
    "筆墨顏色": "Ink colour",
    "清空畫布": "Clear canvas",

    /* ── 手指取景框 ───────────────────────── */
    "手指取景框": "Finger Frame",
    "雙手比 L 字框出一個取景框，框內畫面即時變成負片或馬賽克":
      "Make an L with both hands to frame a shot — whatever falls inside turns negative or pixelated in real time",
    "面對鏡頭，雙手各比出 L 字手勢（拇指與食指張開約 90 度），兩手的虎口會撐出一個取景框":
      "Face the camera and make an L with each hand (thumb and index finger about 90° apart). The two webs of your hands stretch out a viewfinder.",
    "MediaPipe 手部模型即時輸出每隻手 21 個關節點座標":
      "The MediaPipe hand model streams 21 landmark positions per hand",
    "計算拇指與食指向量的夾角，接近 90 度即判定為 L 手勢":
      "The angle between the thumb and index vectors is measured; close to 90° counts as an L gesture",
    "取兩手虎口位置為矩形對角，框內像素逐格重算（負片＝反相、馬賽克＝區塊取樣色）":
      "The two thumb webs become opposite corners of a rectangle, and pixels inside are recomputed each frame (negative = inverted, mosaic = block-sampled colour)",
    "手勢寬鬆度": "Gesture tolerance",
    "框內特效": "Effect inside frame",
    "負片": "Negative",
    "馬賽克": "Mosaic",
    "馬賽克格子大小": "Mosaic block size",
    "請雙手比出 L 字手勢": "Make an L shape with both hands",

    /* ── 聲音漣漪 ─────────────────────────── */
    "聲音漣漪": "Sound Ripples",
    "對著鏡頭與麥克風發聲，畫面會像湖面倒影般盪開漣漪，可切換 2D Canvas／WebGL 兩種渲染":
      "Make a sound at the camera and mic, and the image ripples like a reflection on a lake — switchable between 2D Canvas and WebGL rendering",
    "面對鏡頭，對麥克風說話、拍手或哼聲；每次起音會投入一滴水，聲音越大漣漪越大，音高越高落點越靠上方":
      "Face the camera and talk, clap or hum into the mic. Every attack drops a droplet: louder sounds make bigger ripples, higher pitches land further up the frame.",
    "麥克風訊號經 AnalyserNode 取出波形，算 RMS 得音量，自相關法估音高":
      "An AnalyserNode pulls the waveform from the mic; RMS gives loudness and autocorrelation estimates pitch",
    "鏡頭畫面作為水面倒影，漣漪以高度場梯度對畫面做折射位移，輸出可在 2D Canvas 與 WebGL shader 間切換":
      "The camera feed acts as the reflection on the water; the height-field gradient refracts it, and output switches between 2D Canvas and a WebGL shader",
    "音量只在跨過門檻的起音瞬間投滴，音量決定能量，音高調整落點高度與衰減率":
      "A droplet falls only on the attack that crosses the threshold — loudness sets its energy, pitch sets its height and decay rate",
    "渲染模式": "Render mode",
    "觸發音量": "Trigger level",
    "WebGL 渲染模式初始化失敗，已回退 2D Canvas。": "WebGL rendering failed to initialise; fell back to 2D Canvas.",
    "音量": "Level",
    "音高": "Pitch",
    "音量→大小，音高→高低位置": "Louder → bigger · Higher pitch → higher up",
    "請允許攝影機與麥克風權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動":
      "Allow camera and microphone access and reload the page. Opening the file directly won't work — launch it with start.bat instead.",

    /* ── 玩弄文字於指尖 ───────────────────── */
    "玩弄文字於指尖": "Text at Your Fingertips",
    "輸入文字，單手時五條文字繩從指尖垂下，雙手時連接兩手對應指尖，可切換純手部拼貼畫面":
      "Type some text: with one hand, five ropes of it hang from your fingertips; with two, they link matching fingers. A hands-only collage mode is one click away.",
    "在上方輸入文字；可調整顯示模式、字體大小、粗細、顏色、緊密度、文字繩長度與重力。純手部模式會移除整片 webcam 背景，只保留到手腕的手與撕紙白邊。單手時文字繩從五指尖垂下並隨手晃動；雙手時文字繩會連接兩手對應指尖":
      "Type your text at the top, then tune display mode, size, weight, colour, spacing, rope length and gravity. Hands-only mode strips the whole webcam background, keeping just your hands up to the wrist with a torn-paper edge. One hand: ropes dangle from all five fingertips and sway as you move. Two hands: each rope links a matching pair of fingertips.",
    "MediaPipe 手部模型即時取得五個指尖座標":
      "The MediaPipe hand model tracks all five fingertip positions in real time",
    "純手部模式用內建人像分割模型，配合手部關鍵點描出的手形與手腕切線，裁出到手腕為止的手並加上撕紙白邊":
      "Hands-only mode combines the bundled person-segmentation model with a hand outline traced from the landmarks and a wrist cut line, then adds a torn-paper white edge",
    "單手時每個指尖固定一條 Verlet 文字繩，另一端受重力自然垂下並保留甩動慣性":
      "With one hand, each fingertip pins one Verlet rope whose free end falls under gravity and keeps its swing momentum",
    "雙手時固定兩手對應指尖，靠節點距離約束產生連接兩手的文字繩":
      "With two hands, matching fingertips are pinned at both ends and distance constraints between nodes form the connecting rope",
    "顯示模式": "Display mode",
    "完整畫面": "Full frame",
    "純手部模式": "Hands only",
    "字的大小": "Text size",
    "字的粗細": "Text weight",
    "字的顏色": "Text colour",
    "字的緊密度": "Text spacing",
    "文字繩長度": "Rope length",
    "重力": "Gravity",
    "互動設計實驗": "interaction design experiment",
    "輸入文字…": "Type something…",
    "輸入文字繩內容": "Text rope content",
    "請面對鏡頭伸出手": "Face the camera and hold out your hand",

    /* ── 草稿紙人像 ───────────────────────── */
    "草稿紙人像": "Portrait on Ruled Paper",
    "webcam 把人去背後畫在綠色作文稿紙上，可用鉛筆排線或循環文字排出人像；拖曳格線把稿紙撕開一條縫，縫內切換成連續鉛筆素描":
      "Your webcam cuts you out and redraws you on green manuscript paper, in pencil hatching or looping text. Drag along a grid line to tear the paper open — inside the gap, a continuous pencil sketch takes over.",
    "面對鏡頭，人像會以鉛筆塗法畫滿稿紙格子；可切到文字模式並輸入繁中文字，暗部格子會改由循環文字組成人像。在畫面上按住格線往左右或上下拖曳，稿紙會沿那條線撕開一條縫（拖曳點最寬、往兩端漸收），縫內變成同一個人的連續細緻素描，放開後自動闔上。可調整繪製模式、格子大小與線條濃度":
      "Face the camera and your portrait fills the paper grid with pencil shading. Switch to text mode and type your own words — the darker cells are built from that text on a loop. Press on a grid line and drag sideways or up and down to tear the paper along it (widest at your pointer, tapering to both ends); inside the tear, the same person appears as a fine continuous sketch, and it closes when you let go. Drawing mode, cell size and line density are all adjustable.",
    "人像分割模型即時把人從背景切出，只有人的區域會被作畫":
      "The segmentation model separates the person from the background in real time, so only their silhouette gets drawn",
    "畫面縮到格子解析度取每格明暗，越暗的格子鉛筆塗得越濃；文字模式則用本地手寫字型依明暗填入循環文字":
      "The frame is downscaled to grid resolution to read each cell's brightness — darker cells get heavier pencil; text mode fills them with looping characters in a local handwriting font instead",
    "撕縫處用 raised-cosine 把格線兩側往外推開（拖曳點最寬、兩端漸收），縫內改用連續素描濾鏡畫同一個人":
      "The tear pushes both sides of the grid line apart with a raised-cosine profile (widest at the pointer, tapering away), and a continuous sketch filter redraws the same person inside the gap",
    "光影在稿紙上慢慢長成人像": "light and shadow slowly grow into a portrait",
    "輸入繁中文字，會循環填滿暗部格子": "Type text — it loops to fill the darker cells",
    "文字模式內容": "Text mode content",
    "繪製模式": "Drawing mode",
    "塗黑模式": "Pencil shading",
    "文字模式": "Text mode",
    "格子大小": "Cell size",
    "線條濃度": "Line density",
    "正在開啟相機並載入人像模型，請稍候…": "Starting the camera and loading the person model…",

    /* ── 創世紀手指 ───────────────────────── */
    "創世紀手指": "The Creation Finger",
    "對著鏡頭伸出手，畫面從對角對側伸出一隻手，越往中間靠近，最後兩隻食指指尖相觸，像《創世紀》那幅畫；對面的手畫在你前面，也可改用自己拍下去背的「神之手」":
      "Reach toward the camera and another hand reaches back from the opposite corner, closing in until the two index fingertips touch — just like Michelangelo's Creation. The other hand is drawn in front of yours, and you can swap it for a cut-out of your own.",
    "面對鏡頭伸出手；webcam 做人像去背、疊在純色背景上。當你的手越往畫面中央移動，對面就從「對角對側」伸出一隻手越靠近你，最後兩隻食指指尖相碰（你的手往上伸，對面的手就從上往下伸），且畫在你的前面；相觸停留越久，指尖交會處的火光越亮。對面的手每次隨機是五種風格之一（文藝復興壁畫、卡通、貓掌、機器人、外星人），也可改用你自己的「神之手」。點上方「✋ 創造神之手」可拍下自己的手、自動去背只留手，預覽時用筆刷擦除殘留／補回缺角，確認後對面就換成你的手（反悔按取消）。可調手的大小、最多互動手的數量、圖片手來源（內建五種／我的神之手）":
      "Face the camera and hold out your hand. The webcam cuts you out over a flat backdrop. The closer your hand moves to the centre, the closer the other hand reaches in from the diagonally opposite side, until the two index fingertips meet (reach up and it comes down at you) — and it is drawn in front of your hand. The longer the touch holds, the brighter the spark where the fingertips meet. The other hand is randomly one of five styles (Renaissance fresco, cartoon, cat paw, robot, alien), or your own. Tap \"✋ Create your hand\" to photograph your hand, have it cut out automatically, then brush away leftovers or paint back missing edges in the preview; confirm and it becomes the hand reaching back (cancel to keep the original). Hand size, the maximum number of interacting hands and the hand source (five built-ins / your own) are all adjustable.",
    "MediaPipe 手部模型即時取得每隻手的食指指尖座標，跨幀以最近鄰配對維持身分與隨機風格；對面的手畫在使用者前面":
      "The MediaPipe hand model tracks each index fingertip in real time, with nearest-neighbour matching across frames to keep identity and assigned style stable; the opposing hand is drawn in front of the user",
    "即時畫面用人像分割模型做「整個人」去背，疊在純色背景上":
      "The live frame is matted with the person-segmentation model and composited over a flat backdrop",
    "以畫面中央為對稱點，對面的手永遠在使用者手的對角對側、朝中央伸來，靠指尖到中央的距離換算接近度，相觸於使用者指尖；相觸停留越久，指尖交會處的火光越亮":
      "The frame centre is the point of symmetry: the other hand always reaches in from the diagonally opposite side, its approach driven by the distance from your fingertip to the centre, meeting exactly at your fingertip — and the spark there brightens the longer contact holds",
    "「創造神之手」：拍下使用者的手後，用人像分割遮罩 ∩ 手部關鍵點手形框去背（只留手、不漏臉），旋轉轉正成統一方位，再讓使用者用筆刷擦除殘留／補回缺角，確認後成為互動的圖片手":
      "\"Create your hand\": the captured photo is matted by intersecting the person mask with a hand shape built from the landmarks (hand only, no stray face), rotated upright to a common orientation, then handed to you for brush cleanup before it becomes the image hand",
    "看到一張《創世紀》的圖，聯想到現在科技把各種人與資訊連在一起——觸碰的點很小，後續的發展卻無法預期。":
      "I came across an image of The Creation of Adam and thought about how technology now connects people and information the same way — the point of contact is tiny, and what follows is impossible to predict.",
    "創世紀手指 參考圖 1": "The Creation Finger — reference 1",
    "創世紀手指 參考圖 2": "The Creation Finger — reference 2",
    "創世紀手指 參考圖 3": "The Creation Finger — reference 3",
    "手的大小": "Hand size",
    "最多可互動手的數量": "Max interacting hands",
    "圖片手來源": "Hand image source",
    "內建五種手": "Five built-in hands",
    "我的神之手": "My own hand",
    "✋ 創造神之手": "✋ Create your hand",
    "對著鏡頭伸出你的手": "Hold out your hand to the camera",
    "🧽 擦除": "🧽 Erase",
    "🖌 補回": "🖌 Restore",
    "重置": "Reset",
    "筆畫": "Brush",
    "📸 拍下": "📸 Capture",
    "取消": "Cancel",
    "✓ 用這隻": "✓ Use this one",
    "重拍": "Retake",
    "把手伸進畫面中央，手指張開，按「拍下」":
      "Hold your hand in the centre of the frame with fingers spread, then hit Capture",
    "沒偵測到手，把手伸進畫面再按拍下": "No hand detected — move it into frame and capture again",
    "去背沒成功，調整光線或手的位置再試": "Cut-out failed — adjust the lighting or hand position and try again",
    "🧽擦掉殘留、🖌補回缺角；滿意按「用這隻」，反悔按「取消」回原本":
      "🧽 erase leftovers, 🖌 paint back missing edges. Happy with it? Use this one. Changed your mind? Cancel.",

    /* ── 文字繩連連看 ─────────────────────── */
    "文字繩連連看": "Text Rope Link",
    "輸入文字，單人時文字繩一端黏在鼻子上、另一端自由垂下隨頭甩動；多人時連接最靠近的兩顆頭、受重力下垂成弧且文字沿繩流動，距離太遠會斷開":
      "Type some text: alone, a rope of it sticks to your nose and swings freely as you move; with others, it links the two nearest heads, sagging into an arc with the text flowing along it — and snapping if you drift too far apart",
    "面對鏡頭並輸入文字。只有你一人時，文字繩一端黏在你的鼻子上、另一端柔軟自由垂下，會隨著頭移動而晃動（可調甩動誇張度做出甩鼻涕般效果）；出現其他人時，文字繩會連到最靠近你的人的頭頂、受重力在中間下垂成弧、文字沿繩流動，超過最遠連接距離就斷開成各自垂下的繩。可調文字大小、疏密、粗細、顏色、最遠連接距離、重力、單人繩長度、晃動柔軟度、甩動誇張度與雙人文字流動速度":
      "Face the camera and type. On your own, the rope pins to your nose and hangs loose, swaying as your head moves (crank up the whip factor for a properly silly swing). When someone else appears, it links to the nearest head, sags into an arc under gravity and the text flows along it — drift past the maximum link distance and it snaps back into two separate ropes. Text size, spacing, weight and colour, link distance, gravity, solo rope length, sway softness, whip factor and flow speed are all adjustable.",
    "FaceDetector 即時偵測每個人的頭部與鼻尖關鍵點，跨幀以最近鄰配對維持身分、並帶速度預測減少延遲":
      "FaceDetector tracks every head and nose landmark in real time, with nearest-neighbour matching across frames to keep identity and velocity prediction to cut latency",
    "繩子用時間修正(dt)的 Verlet 物理，不同 fps 手感一致；繩長剛性，甩動的彎曲拖尾來自慣性":
      "The rope runs time-corrected (dt) Verlet physics so it feels the same at any frame rate; length stays rigid and the trailing curve comes purely from momentum",
    "單人繩硬釘鼻尖、自由垂掛；甩動誇張度把頭部速度平滑放大去驅動固定端，逐節延遲產生鞭狀拖尾":
      "The solo rope is pinned hard to the nose tip and hangs free; the whip factor smoothly amplifies head velocity to drive that anchor, and the per-node lag produces the whip-like trail",
    "每個人找最靠近的另一個人，距離在門檻內就連線；雙人繩兩端釘頭頂、受重力下垂成弧，文字沿繩流動":
      "Each person looks for their nearest neighbour and links up if they are within the threshold; the shared rope pins to both heads, sags under gravity and carries the text along it",
    "兩人拉遠超過最遠連接距離，連接繩斷開、變回各自的單人繩":
      "Move beyond the maximum link distance and the shared rope snaps, reverting to two solo ropes",
    "請允許相機權限，並確認瀏覽器支援 getUserMedia。建議用 start.bat 啟動本機伺服器後再開啟效果。":
      "Allow camera access and make sure your browser supports getUserMedia. Launching the local server with start.bat first is recommended.",
    "輸入要掛在線上的文字": "Text to hang on the rope",
    "文字大小": "Text size",
    "文字疏密（越大越疏）": "Text spacing (higher = sparser)",
    "文字粗細": "Text weight",
    "文字顏色": "Text colour",
    "最遠連接距離": "Max link distance",
    "重力大小": "Gravity",
    "文字繩長度（單人）": "Rope length (solo)",
    "晃動柔軟度": "Sway softness",
    "甩動誇張度（單人）": "Whip factor (solo)",
    "文字流動速度（雙人，0＝靜止）": "Text flow speed (paired, 0 = still)",
    "字": "text",
    "站到鏡頭前，靠近朋友就會連成文字繩":
      "Step in front of the camera — get close to a friend and a text rope links you",
    "正在啟動相機與人臉偵測...": "Starting the camera and face detection…",

    /* ── 手指切割世界 ─────────────────────── */
    "手指切割世界": "Cut the World",
    "伸出食指在鏡頭畫面上畫一個封閉形狀，那塊世界會發光掉落，洞裡露出套用特效的虛擬空間":
      "Draw a closed shape on the camera feed with your index finger and that piece of the world glows, falls away, and reveals a treated virtual space behind the hole",
    "面對鏡頭，伸出食指、收起中指與無名指，停住約半秒，指尖發光後就能在空中畫一個封閉形狀；路徑閉合後發光 1 秒，那塊畫面便掉落，碎片會互相碰撞彈跳、堆在畫面底部約 8 秒後淡出；洞裡透出套用特效的即時畫面。可連續切好幾刀，洞會累積、重疊的洞會合併成更大的洞，按右上角「重置世界」復原。可選洞內特效（科技像素／動態亂碼／印刷拼貼／色塊版畫），並調整特效顆粒、洞緣厚度與掉落速度":
      "Face the camera, raise your index finger with the middle and ring fingers tucked in, and hold still for about half a second. Once the fingertip lights up, draw a closed shape in the air. When the path closes it glows for a second, then that patch of the image drops away — the shards collide, bounce, pile up at the bottom and fade after about 8 seconds, while the hole shows the treated live feed behind it. Keep cutting: holes accumulate and overlapping ones merge into bigger ones. Reset World in the top right restores everything. Pick the effect behind the hole (tech pixels / glitch rain / print collage / flat-colour print) and tune its grain, the edge thickness and the fall speed.",
    "MediaPipe 手部模型即時取得食指指尖座標，以指節距離判定「只伸食指」手勢，維持半秒確認後才開始記錄軌跡":
      "The MediaPipe hand model tracks the index fingertip, and knuckle distances identify the index-only gesture — held for half a second before the path starts recording",
    "軌跡自我相交或首尾靠近即形成封閉多邊形，發光一秒後把該區畫面快照成碎片":
      "The path closes into a polygon once it self-intersects or its ends come close, glows for a second, then snapshots that region into shards",
    "碎片以凸包剛體交給 Matter.js 模擬：依形狀翻倒、彈跳、堆疊，支撐消失自動掉落，落定 8 秒後淡出；重疊的洞自動聯集，洞緣取畫面色壓暗畫出牆體斷面與內陰影做出厚度，透出特效版即時畫面":
      "Shards go to Matter.js as convex-hull rigid bodies: they topple, bounce and stack by shape, fall when their support disappears, and fade 8 seconds after settling. Overlapping holes union automatically, and the rim darkens sampled screen colour into a wall cross-section with an inner shadow for thickness, framing the treated live feed",
    "四種特效以低解析度取樣重繪，亮度自動對比拉伸：像素量化、字雨（移動閃白）、半調網點、版畫平塗":
      "All four effects redraw from low-resolution samples with automatic contrast stretching: pixel quantisation, character rain (drifting white flicker), halftone dots and flat print blocks",
    "探索螢幕後面的虛擬空間，平面的螢幕後可能有著無限的空間。":
      "An exploration of the virtual space behind the screen — a flat display might hide something endless.",
    "切割世界 參考圖 1（動態亂碼）": "Cut the World — reference 1 (glitch rain)",
    "切割世界 參考圖 2（科技像素）": "Cut the World — reference 2 (tech pixels)",
    "切割世界 參考圖 3（印刷拼貼）": "Cut the World — reference 3 (print collage)",
    "切割世界 參考圖 4（色塊版畫）": "Cut the World — reference 4 (flat-colour print)",
    "洞內特效": "Effect inside hole",
    "科技像素": "Tech pixels",
    "動態亂碼": "Glitch rain",
    "印刷拼貼": "Print collage",
    "色塊版畫": "Flat-colour print",
    "特效顆粒": "Effect grain",
    "洞緣厚度": "Edge thickness",
    "掉落速度": "Fall speed",
    "重置世界": "Reset world",
    "伸出食指停住半秒，指尖發光後畫出封閉形狀":
      "Raise your index finger and hold for half a second — once it glows, draw a closed shape",

    /* ── 放大鏡 ───────────────────────────── */
    "放大鏡": "Magnifier",
    "一顆玻璃透鏡跟著滑鼠在 webcam 畫面上滑動，可切換放大鏡、一般玻璃、毛玻璃三種鏡片":
      "A glass lens glides over the webcam feed with your cursor — switch between magnifier, plain glass and frosted glass",
    "面對鏡頭並移動滑鼠（或手指拖曳），玻璃透鏡會平滑跟著游標；可切換鏡片模式，並調整鏡片大小、放大倍率、折射扭曲、邊緣色散、邊緣高光與毛玻璃模糊":
      "Face the camera and move the mouse (or drag with a finger) — the lens follows smoothly. Switch lens mode and adjust size, magnification, refraction, edge dispersion, rim highlight and frosted blur.",
    "webcam 畫面上傳成 WebGL 紋理，整個畫面交給 fragment shader 逐像素重算":
      "The webcam frame is uploaded as a WebGL texture and the whole image is recomputed per pixel in a fragment shader",
    "透鏡內把取樣座標往鏡心縮放做出放大，越靠邊緣偏移越大，模擬厚玻璃折射":
      "Inside the lens, sample coordinates scale toward its centre to magnify, with larger offsets near the rim to imitate thick-glass refraction",
    "RGB 三色用略微不同的縮放取樣，邊緣出現彩虹色散；再疊上弧形高光、邊緣壓暗與外圈落影做出玻璃厚度":
      "R, G and B sample at slightly different scales for rainbow fringing at the edge, then a curved highlight, darkened rim and outer drop shadow give the glass its thickness",
    "毛玻璃用黃金角螺旋多點取樣平均成模糊，再混入一點白霧":
      "Frosted glass averages multiple samples on a golden-angle spiral into a blur, with a little white haze mixed in",
    "測試網頁可以製作什麼樣的玻璃效果。": "A test of just how convincing glass can get on the web.",
    "鏡片模式": "Lens mode",
    "一般玻璃": "Plain glass",
    "毛玻璃": "Frosted glass",
    "鏡片大小": "Lens size",
    "放大倍率（放大鏡）": "Magnification (magnifier)",
    "折射扭曲": "Refraction",
    "邊緣色散": "Edge dispersion",
    "邊緣高光": "Rim highlight",
    "毛玻璃模糊": "Frosted blur",
    "此效果需要支援 WebGL 的瀏覽器，請改用 Chrome / Edge":
      "This effect needs a WebGL-capable browser — please use Chrome or Edge",

    /* ── 聲音煙火 ─────────────────────────── */
    "聲音煙火": "Sound Fireworks",
    "對麥克風發聲或打鼓就發射一發煙火：寫實貓咪頭碎成貓形點狀雲，或一道色鉛筆線把白紙炸出一個洞；也能關掉煙火只看後面那層流動背景":
      "Every sound or drum hit into the mic launches a firework: a photoreal cat bursting into a cat-shaped cloud of dots, or a coloured pencil line blowing a hole clean through white paper. You can also turn the fireworks off and just watch the flowing layer behind them.",
    "對著麥克風打鼓、拍手或發聲。貓咪煙火風格是純黑背景，隨機射出一隻貓（橘虎斑、賓士、布偶、暹羅），一路變大並逐格演出牠的專屬動作，到頂點時一邊繼續放大一邊化成細點狀的粒子雲、聚成更大的貓頭形狀再散開；紙張破裂煙火風格的背景是一張白紙，色鉛筆線從畫面底部一口氣甩上去畫出升起的軌跡（每發隨機抽色），到頂點時紙從線的末端被撕開、四周甩出幾筆彩色火花、邊上掀起紙片露出後面黑白流體潑漆＋全息虹光的動畫，撐一下再原樣倒放合回去；也可以選「只看背景動態」把煙火整個關掉，讓那層流體鋪滿畫面。可調視覺風格、觸發音量、煙火大小與顏色":
      "Drum, clap or make noise into the mic. Cat fireworks play on pure black: a random cat launches (ginger tabby, tuxedo, ragdoll, siamese), growing as it flies and acting out its own frame-by-frame animation; at the apex it keeps expanding while dissolving into a fine particle cloud that gathers into a much larger cat head before scattering. Paper-tear fireworks play on white paper: a coloured pencil line whips up from the bottom edge in one stroke (a new colour every shot), and at the apex the paper tears open at its tip, flinging coloured sparks around it while the lifted flaps reveal a black-and-white fluid pour with holographic shimmer behind — it holds a beat, then plays in reverse to seal shut. Or pick \"Background only\" to switch the fireworks off entirely and let that fluid layer fill the screen. Visual style, trigger level, firework size and colour are all adjustable.",
    "麥克風波形算 RMS 得音量，只在跨過門檻的起音瞬間發射，90 毫秒不應期讓鼓點能連發":
      "RMS on the mic waveform gives loudness; a shot fires only on the attack that crosses the threshold, with a 90 ms refractory window so drum rolls still register",
    "頻譜重心代表聲音明亮度，決定飛到多高；音量決定大小與粒子數量，最小到最大差 4 倍以上":
      "Spectral centroid stands in for brightness and sets the flight height; loudness sets size and particle count, spanning more than 4× from smallest to largest",
    "貓咪上升位置用 smoothstep：慢起步、中段最快、到頂點前收住，做出衝上去再停住的加速度感":
      "The cat's rise follows a smoothstep — slow off the mark, fastest mid-flight, easing before the apex — for that shoot-up-then-hang feeling",
    "整套模擬固定跑 12 fps，四隻寫實貓各有一套 6 格序列圖，依飛行進度換格做出逐格動畫的頓挫感":
      "The whole simulation runs at a fixed 12 fps, and each of the four photoreal cats has its own 6-frame sequence stepped by flight progress for a deliberately choppy animation",
    "爆炸從貓咪圖本身長出來：縮到 56×56 取樣換成帶原色的粒子，到頂點時照片一邊放大一邊淡出、粒子剪影同步脹大淡入接手，再繼續聚到更大的貓頭輪廓上，最後才散成點狀雲":
      "The burst grows out of the cat photo itself: downsampled to 56×56 and turned into particles carrying the original colours. At the apex the photo scales up as it fades while the particle silhouette swells and fades in to take over, gathers onto a much larger cat-head outline, and only then scatters into a cloud of dots",
    "紙張的破口改用序列圖播放：四種不規則撕法各 6 格從小裂口撕到滿，合回去就是同一組影格倒放、而且用 1.6 倍速跳著播；貼片只留掀起的紙片與影子，平坦紙面全透明才不會蓋掉色鉛筆線":
      "The paper tear plays as a sequence: four irregular tear patterns, 6 frames each, going from a small split to a full rip, then the same frames reversed at 1.6× with frames skipped to close. Each sprite keeps only the lifted flaps and their shadows — the flat paper is fully transparent so it never covers the pencil line",
    "洞後面那層黑白流體是唯一用 WebGL 的部分：fragment shader 跑兩輪域變形雜訊做出湍流，整片都是流體只是調子從近黑到亮白連續變化（用門檻切的話暗部會變成純黑空洞），虹光則由另一層雜訊當遮罩控制分布，頻率決定散得多開、門檻決定總量":
      "The black-and-white fluid behind the hole is the only WebGL part: a fragment shader runs two rounds of domain-warped noise for turbulence. The whole field is fluid, its tone sliding continuously from near-black to bright white (thresholding would punch the dark areas into black voids), while a second noise layer masks the iridescence — frequency sets how far it spreads, threshold sets how much there is",
    "那張流體圖是整片鋪滿畫面的，clip 出洞形後把變換重設回畫面座標再貼上，洞開合時後面的影像才不會跟著縮放":
      "The fluid image covers the entire canvas: after clipping to the hole shape the transform resets to screen coordinates before drawing, so the image behind doesn't scale as the hole opens and closes",
    "色鉛筆線是一記快甩：170 毫秒、ease-out 起手就最快，從畫面底緣外側起筆不留空白，一格拆四小段畫所以甩得快也不會斷成折線；每一發隨機抽色也隨機抽粗細，破口周圍再甩出 10～18 筆又短又粗的彩色短觸當綻放的火花":
      "The pencil line is one fast whip: 170 ms, ease-out so it's quickest off the mark, starting outside the bottom edge to avoid a gap, and split into four sub-segments per frame so speed never breaks it into a polyline. Colour and thickness are drawn at random per shot, and 10–18 short thick coloured dashes fling out around the tear as the burst",
    "畫布的 backing store 乘上 devicePixelRatio（封頂 2）再用 setTransform 把座標縮回 CSS 像素，高 DPI 螢幕上才不會被拉伸糊掉":
      "The canvas backing store is multiplied by devicePixelRatio (capped at 2) and setTransform scales coordinates back to CSS pixels, so nothing looks stretched or soft on high-DPI screens",
    "最近在學打鼓，想要有個可以互動的視覺。": "I've been learning drums and wanted something visual to play along with.",
    "煙火參考圖 1": "Fireworks reference 1",
    "煙火參考圖 2": "Fireworks reference 2",
    "煙火參考圖 3": "Fireworks reference 3",
    "視覺風格": "Visual style",
    "貓咪煙火": "Cat fireworks",
    "紙張破裂煙火": "Paper-tear fireworks",
    "只看背景動態": "Background only",
    "煙火大小": "Firework size",
    "煙火顏色": "Firework colour",
    "貓咪序列圖載入失敗，請確認 frames/ 資料夾內的圖檔完整":
      "The cat frame sequence failed to load — check that the images in frames/ are complete",
    "請允許麥克風權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動":
      "Allow microphone access and reload the page. Opening the file directly won't work — launch it with start.bat instead.",

    /* ── 拉拉鍊 ───────────────────────────── */
    "拉拉鍊": "Zipper Pull",
    "拉開寫實牛仔褲或皮革包包的拉鍊，看看裡面這次藏著哪個奇怪世界":
      "Unzip a photoreal pair of jeans or a leather bag and see which strange little world is hiding inside this time",
    "按住拉鍊頭沿拉鍊方向拖曳（牛仔褲上下、包包左右），拖曳時會有拉鍊音效；拉回閉合後，下次拉開會換內容。也可開啟攝影機，用拇指與食指捏合拉鍊頭拖曳":
      "Grab the slider and drag it along the zip (up and down on the jeans, side to side on the bag) — it sounds like the real thing. Close it and the next pull reveals something new. Turn the camera on and you can pinch the slider between thumb and index finger instead.",
    "拉開過程用連續幀（布料皺褶真實），開口內部是 alpha 透明；程式依拖曳進度在相鄰幀間交叉淡化，拉鍊頭貼著開口尖點跟手移動。牛仔褲 7 幀（第 1 幀起鈕扣鬆開，連腰口一起張開）、包包 9 幀，開口都是 alpha 透明；接進來前逐幀對齊色彩，拖曳時不會閃":
      "The pull runs on a frame sequence (so the fabric creases convincingly) with the opening left alpha-transparent. Drag progress cross-fades between adjacent frames while the slider tracks the tip of the opening under your finger. The jeans use 7 frames (the button comes undone from frame 1, so the waistband opens with it) and the bag 9, both with alpha-transparent openings; colours are matched frame by frame before import so nothing flickers mid-drag",
    "開口下方保留 DOM 圖片層，讓跨域 GIF 與 MJPEG 不經 Canvas 就能原生播放；連網來源逾時或失敗自動換源並退回本地圖包，GIF 會預抓下一張":
      "A DOM image layer sits under the opening so cross-origin GIFs and MJPEG streams play natively without going through Canvas; online sources that time out or fail switch automatically and fall back to the local image pack, and the next GIF is prefetched",
    "手勢模式開啟時才載入攝影機與 MediaPipe Hands，以鏡像食指當游標，拇指食指捏合判定抓取":
      "The camera and MediaPipe Hands only load when gesture mode is on, using the mirrored index finger as the cursor and a thumb-index pinch as the grab",
    "音效是一段 CC0 真實拉鍊錄音剪成的 1 秒無縫循環，用 Web Audio 循環播放並讓 playbackRate 等於拖曳速度：慢拉聽得到一顆顆齒、快拉連成「滋」一聲，停手即淡出":
      "The sound is a CC0 recording of a real zip cut into a 1-second seamless loop, played through Web Audio with playbackRate tied to drag speed: pull slowly and you hear individual teeth, pull fast and they merge into one zzzip, and it fades out the moment you stop",
    "靈感來自 MV 裡重複上下拉褲子拉鍊的畫面；忘記拉拉鍊有時尷尬，卻也帶著一點荒謬的幽默。":
      "Inspired by a music video shot of a fly being zipped up and down on repeat — forgetting to zip up is embarrassing, but there's a certain absurd humour in it too.",
    "衣服": "Item",
    "牛仔褲": "Jeans",
    "包包": "Bag",
    "內容來源": "Content source",
    "隨機混合": "Random mix",
    "本地趣圖包": "Local image pack",
    "迷因動圖（連網）": "Meme GIFs (online)",
    "即時監視器（連網）": "Live cameras (online)",
    "手勢模式": "Gesture mode",
    "關": "Off",
    "開": "On",
    "拉鍊後方內容": "Content behind the zip",
    "正在開啟相機與手勢辨識，請稍候…": "Starting the camera and gesture tracking…",
    "正在準備拉鍊素材…": "Preparing the zip artwork…",
    "拉鍊素材載入失敗，請確認專案檔案完整後重新整理。":
      "The zip artwork failed to load — check the project files are complete and reload.",
    "無法開啟攝影機。請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 或 HTTPS 開啟。":
      "Couldn't start the camera. Allow camera access and reload the page; opening the file directly won't work — use start.bat or HTTPS."
  };

  const lang = localStorage.getItem("lang") === "en" ? "en" : "zh";

  // 找不到就原樣回傳：漏翻只會退回中文，不會變成空白或 key
  function t(value) {
    if (lang !== "en" || typeof value !== "string") {
      return value;
    }
    return DICT[value] || DICT[value.trim()] || value;
  }

  function createSwitch() {
    const box = document.createElement("div");
    box.className = "lang-switch";
    for (const [code, label] of [["zh", "中"], ["en", "EN"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = code === lang ? "is-active" : "";
      button.addEventListener("click", () => {
        if (code === lang) return;
        localStorage.setItem("lang", code);
        location.reload();
      });
      box.append(button);
    }
    return box;
  }

  const style = document.createElement("style");
  style.textContent = `
.lang-switch{position:fixed;top:16px;right:16px;z-index:50;display:flex;align-items:center;
  height:40px;padding:0 4px;border:1px solid currentColor;border-radius:999px}
.lang-switch button{height:32px;padding:0 11px;border:0;border-radius:999px;background:none;
  color:inherit;font:inherit;font-size:.78rem;letter-spacing:.06em;cursor:pointer;opacity:.45}
.lang-switch button:hover{opacity:.8}
.lang-switch button.is-active{opacity:1;font-weight:600}
/* 效果頁併進右上角既有的按鈕列，才不會蓋住 ⓘ */
.shell-actions .lang-switch{position:static;background:rgba(0,0,0,.5);backdrop-filter:blur(14px);
  border-color:var(--shell-line,currentColor)}`;
  document.head.append(style);

  window.t = t;
  window.I18N = { lang, createSwitch };

  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hant";
    document.title = t(document.title);
    for (const el of document.querySelectorAll("[data-i18n]")) {
      el.textContent = t(el.textContent.trim());
    }
    // 效果頁由 shell.js 自己插進 .shell-actions
    if (!document.body.classList.contains("shell-page")) {
      document.body.append(createSwitch());
    }
  });
})();
