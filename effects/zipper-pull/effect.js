const shell = Shell.init({ id: "zipper-pull" });
const contentLayer = document.createElement("div");
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const preview = document.createElement("video");
const gestureCursor = document.createElement("div");

// 幀序列：0=閉合、之後逐步拉開，開口內部為 alpha 透明。
// 牛仔褲（v5）是外部給的去背 PNG，接進來前逐幀對齊色彩、把透明區的 RGB 往外擴（避免白邊）後轉 webp；
// 包包（v4）是 AI 生成後對齊閉合幀、依開口顏色去背轉 alpha 而來。
// apex／line=每幀開口尖點與齒條的原圖座標（素材量測），程式依進度內插。
const GARMENTS = {
  jeans: {
    // v5：1672x941 的 7 幀。第 0 幀是扣好的完整褲身（無開口），第 1 幀起鈕扣鬆開、
    // 腰口跟著張開，所以開口不只門襟，還含腰頭以上那塊——拉開後從腰口就看得到後方。
    frames: Array.from({ length: 7 }, (_, i) => `assets/frames/jeansv5-${i}.webp`),
    sliderUrl: "assets/slider-jeans2.webp",
    // 第 0 幀沿門襟切出來的右片。閉合時疊在拉鍊頭上面，讓拉鍊頭有一半藏在蓋布下，
    // 才不會整個浮在布料外；一起拉就跟著第 0 幀一起淡出。
    flapUrl: "assets/frames/jeansv5-0-flap.webp",
    size: [1672, 941],
    // 保證看得到的原圖範圍 [x, y, 寬]：左右切在褲身外側車縫線（x≈75／1595）外一點，
    // 上緣切掉腰頭上方那條，畫面才不會一半都是腰口，拉起來比較像在拉自己的褲子。
    // 高度不給——一律從 y 吃到圖的下緣，寫死才不會忘了跟著 y 調、下緣露出底色。
    // 想整體放大就把「寬」改小、x 跟著調回置中（x = 836 - 寬/2）。
    view: [80, 90, 1510],
    axis: "v",
    // 齒條的原圖 x：各幀量到的位置差到 20px，只用一個值拉鍊頭就會偏出齒條
    line: [828, 844, 846, 849, 850, 858, 838],
    // 第 0 幀沒有開口，尖點取在門襟蓋布下方一點：拉鍊頭有一半被 flap 蓋住，
    // 露出來的那半剛好接上齒條，跟第 1 幀的位置也連得起來
    apex: [280, 412, 441, 476, 575, 774, 808],
    // 內容層只鋪這塊原圖區域（開口最大範圍外擴一點），避免內容被放大到糊掉
    contentBox: [160, 0, 1330, 830]
  },
  bag: {
    // v4：9 幀走完包包的橫向拉鍊；提把座隨各自皮革片移動。
    frames: Array.from({ length: 9 }, (_, i) => `assets/frames/bagv4-${i}.webp`),
    sliderUrl: "assets/slider-jeans2.webp",
    size: [2048, 1152],
    axis: "h",
    line: [577],
    apex: [143, 511, 606, 795, 1021, 1327, 1673, 1913, 1915],
    contentBox: [103, 311, 1838, 464],
    // 開口邊緣是程式化合成的，缺乏皮革厚度；加一圈暗部補深度感（原圖像素）。
    // 範圍與濃度都壓到剛好看得出厚度：再深就會糊進開口內的內容，看起來像髒污。
    rimShadow: 6,
    rimDarkness: 0.62
  }
};

const LOCAL_CONTENTS = Array.from({ length: 8 }, (_, index) => `assets/pack/p${index + 1}.jpg`);
const CCTV_STREAMS = [
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10002",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10070",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10280",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10450",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10800",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=11300",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=12690",
  "https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=13270"
];
const NETWORK_TIMEOUT_MS = 8000;
const CAMERA_ERROR = "無法開啟攝影機。請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 或 HTTPS 開啟。";

const state = {
  garment: "jeans",
  source: "mixed",
  gestureMode: "off",
  progress: 0,
  width: 1,
  height: 1,
  dpr: 1,
  dragging: false,
  contentGeneration: 0,
  pendingContent: null,
  activeContent: null,
  lastContentKey: "",
  lastLocalIndex: -1,
  lastCctvIndex: -1,
  nextGif: null,
  renderQueued: false,
  snapId: 0,
  garmentImages: new Map(),
  sliderImages: new Map(),
  flapImages: new Map(),
  gestureGeneration: 0,
  gestureAnimationId: 0,
  gestureLandmarker: null,
  gestureStream: null,
  lastVideoTime: -1,
  gestureGrabbed: false,
  gestureWasPinched: false,
  gestureCursorX: -1,
  gestureCursorY: -1
};

const style = document.createElement("style");
style.textContent = `
  .zipper-content-layer img,
  .zipper-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  /* 內容層只鋪滿開口範圍（由 contentBox 定位），不放大到整個畫面，解析度才不會糊掉 */
  .zipper-content-layer { position: absolute; overflow: hidden; background: #111; }
  .zipper-content-layer img {
    object-fit: cover;
    display: block;
    opacity: 0;
    transition: opacity 160ms ease;
  }
  .zipper-canvas { display: block; touch-action: none; cursor: grab; }
  .zipper-canvas.is-dragging { cursor: grabbing; }
  .zipper-preview {
    position: absolute;
    right: 18px;
    bottom: 18px;
    width: min(24vw, 220px);
    aspect-ratio: 4 / 3;
    display: none;
    object-fit: cover;
    transform: scaleX(-1);
    border: 2px solid rgba(255, 255, 255, 0.82);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
    background: #111;
    z-index: 2;
  }
  .zipper-gesture-cursor {
    position: absolute;
    width: 22px;
    height: 22px;
    display: none;
    border: 3px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.42), 0 0 20px rgba(255, 255, 255, 0.7);
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 3;
  }
  .zipper-gesture-cursor.is-pinched { background: rgba(255, 255, 255, 0.5); }
  .zipper-gesture-cursor.is-near {
    border-color: #ffd25a;
    box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.42), 0 0 24px rgba(255, 210, 90, 0.9);
  }
  .zipper-gesture-cursor.is-grabbed { background: #ffd25a; border-color: #ffd25a; }
`;
document.head.append(style);

contentLayer.className = "zipper-content-layer";
canvas.className = "zipper-canvas";
preview.className = "zipper-preview";
preview.muted = true;
preview.playsInline = true;
gestureCursor.className = "zipper-gesture-cursor";
shell.container.style.overflow = "hidden";
shell.container.style.background = "#111";
shell.container.append(contentLayer, canvas, preview, gestureCursor);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shuffleIndexes(length, preferredStart) {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  if (indexes.length > 1 && indexes[0] === preferredStart) {
    [indexes[0], indexes[1]] = [indexes[1], indexes[0]];
  }
  return indexes;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`image load failed: ${url}`));
    image.src = url;
  });
}

function getLayout() {
  const garment = GARMENTS[state.garment];
  const [imageWidth, imageHeight] = garment.size;
  let scale;
  let offsetX;
  let offsetY;
  if (garment.axis === "v") {
    // 牛仔褲：只保證看到 view 這塊（滿版比例不變，兩側延伸與腰口上緣裁到畫面外）。
    const [vx, vy, vw] = garment.view;
    scale = Math.max(state.width / vw, state.height / (imageHeight - vy));
    offsetX = state.width * 0.5 - (vx + vw * 0.5) * scale;
    // 預設讓 view 上緣貼齊畫面頂端，但拉到底的拉鍊頭一定要整個留在畫面內
    // （下方再留一點，避免貼著視窗邊或作業系統工具列）。畫面比 view 需要的還寬時
    // scale 會被寬度撐大、尖點被推低，這時整組往上推剛好夠的量；
    // 下界擋住圖的下緣，所以推再多也不會露出圖外。
    const lastApex = garment.apex[garment.apex.length - 1];
    offsetY = clamp(
      -vy * scale,
      state.height - imageHeight * scale,
      Math.min(0, state.height - sliderRoom() - lastApex * scale)
    );
  } else {
    // 包包（水平拉鍊）：貼齊畫面寬，直式螢幕上下留邊（drawScene 補底色）
    scale = state.width / imageWidth;
    offsetX = 0;
    offsetY = (state.height - imageHeight * scale) * 0.5;
  }
  const along = garment.axis === "v" ? offsetY : offsetX;
  const apexScreen = garment.apex.map((value) => along + value * scale);
  const acrossOffset = garment.axis === "v" ? offsetX : offsetY;
  const lineScreen = garment.line.map((value) => acrossOffset + value * scale);
  const axisMax = (garment.axis === "v" ? state.height : state.width) - 24;
  // 拉鍊頭的長邊。往上推到極限還是塞不下時（矮視窗、下方有工具列），縮小它補足；
  // 依「拉到底」的位置算，拖曳途中大小才不會變。
  const lastTip = apexScreen[apexScreen.length - 1];
  const fit = garment.axis === "v" ? (state.height - lastTip - 20) / 1.15 : Infinity;
  const sliderLong = clamp(Math.min(state.width * 0.095, fit), 40, 92);
  return {
    garment,
    scale,
    offsetX,
    offsetY,
    apexScreen,
    lineScreen,
    sliderLong,
    dragTop: apexScreen[0],
    bottom: Math.min(apexScreen[apexScreen.length - 1], axisMax),
    imageWidth,
    imageHeight
  };
}

// 依進度在相鄰幀之間線性內插一組「每幀量測值」
function atProgress(values) {
  const f = clamp(state.progress, 0, 1) * (values.length - 1);
  const i = Math.floor(f);
  if (i >= values.length - 1) {
    return values[values.length - 1];
  }
  return values[i] + (values[i + 1] - values[i]) * (f - i);
}

// 目前進度對應的開口尖點。尖點不必跟著幀的溶接曲線走：
// drawScene 會把開口裁在這個位置，對齊是切出來的。
const tipScreen = (layout) => atProgress(layout.apexScreen);
// 齒條的橫向位置，同樣跟著幀走
const lineAt = (layout) => atProgress(layout.lineScreen);

// 指標位置反推進度：apex 單調遞增，逐段線性反查，讓拉鍊頭精準跟手
function progressFromPointer(pos, layout) {
  const a = layout.apexScreen;
  const last = a.length - 1;
  if (pos <= a[0]) {
    return 0;
  }
  if (pos >= a[last]) {
    return 1;
  }
  for (let i = 0; i < last; i++) {
    if (pos <= a[i + 1]) {
      return (i + (pos - a[i]) / Math.max(1, a[i + 1] - a[i])) / last;
    }
  }
  return 1;
}

// 拉鍊頭在尖點下方吃掉的高度：圖只有 8% 重疊在尖點上方，其餘往下畫（1.25×長邊），
// 再加陰影與離視窗邊的餘裕。版面靠它決定要把整組往上推多少。
function sliderRoom() {
  return clamp(state.width * 0.095, 58, 92) * 1.15 + 36;
}

function drawSlider(layout, tip) {
  const slider = state.sliderImages.get(state.garment);
  if (!slider) {
    return;
  }
  const longest = layout.sliderLong;
  const ratio = slider.naturalWidth / Math.max(1, slider.naturalHeight);
  let width = longest;
  let height = longest / Math.max(0.35, ratio);
  if (height > longest * 1.25) {
    height = longest * 1.25;
    width = height * ratio;
  }
  const line = lineAt(layout);
  context.save();
  if (layout.garment.axis === "v") {
    context.translate(line, tip);
  } else {
    // 包包：滑塊轉 90°，冠部朝開口側（左）
    context.translate(tip, line);
    context.rotate(-Math.PI / 2);
  }
  context.shadowColor = "rgba(0, 0, 0, 0.65)";
  context.shadowBlur = 10;
  // 冠部貼著開口尖點（只重疊 8% 高度），不會懸空在開口裡
  context.drawImage(slider, -width * 0.5, -height * 0.08, width, height);
  context.restore();
}

// 內容層對齊開口所在的原圖區域，隨版面縮放同步
function updateContentBox(layout) {
  const box = layout.garment.contentBox;
  if (!box) {
    return;
  }
  const [bx, by, bw, bh] = box;
  contentLayer.style.left = `${layout.offsetX + bx * layout.scale}px`;
  contentLayer.style.top = `${layout.offsetY + by * layout.scale}px`;
  contentLayer.style.width = `${bw * layout.scale}px`;
  contentLayer.style.height = `${bh * layout.scale}px`;
}

function drawScene() {
  state.renderQueued = false;
  const layout = getLayout();
  updateContentBox(layout);
  const frames = state.garmentImages.get(state.garment);
  if (!frames) {
    return;
  }
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.clearRect(0, 0, state.width, state.height);
  const dw = layout.imageWidth * layout.scale;
  const dh = layout.imageHeight * layout.scale;
  // 圖沒蓋滿的邊帶補深色，避免後方內容從衣物外露出
  if (layout.offsetY > 0 || layout.offsetX > 0) {
    context.fillStyle = "#181512";
    context.fillRect(0, 0, state.width, Math.max(0, layout.offsetY));
    context.fillRect(0, layout.offsetY + dh, state.width, Math.max(0, state.height - layout.offsetY - dh));
    context.fillRect(0, 0, Math.max(0, layout.offsetX), state.height);
    context.fillRect(layout.offsetX + dw, 0, Math.max(0, state.width - layout.offsetX - dw), state.height);
  }
  const f = clamp(state.progress, 0, 1) * (frames.length - 1);
  const i = Math.min(frames.length - 1, Math.floor(f));
  const frac = f - i;
  // 溶接集中在每一段的開頭快速做完：開口形狀先長到下一幀的樣子，
  // 之後整段都是單一清晰幀，靠下面的裁切把外緣收在拉鍊頭上。
  // 攤平成整段慢慢溶接的話，兩幀之間沒對齊的布料會一直疊成半透明重影。
  // 第 0 段例外：閉合幀跟第 1 幀是「扣著／解開」兩種狀態，不是開口大小的差別，
  // 溶接會同時看到兩顆鈕扣；這段直接給滿，完全交給裁切的斜坡去擦，一起步鈕扣就彈開。
  const bw = clamp(frac / (i === 0 ? 0.005 : 0.15), 0, 1);
  const blend = bw * bw * (3 - 2 * bw);
  const tip = tipScreen(layout);
  // 開口內緣的暗部：把幀影模糊壓暗後墊一層，正片會蓋掉大部分，
  // 只在開口邊緣留下一圈柔和陰影，做出袋口／布料的厚度感。
  // 溶接中改拿「較開的那幀」當陰影：陰影是不透明的，用較閉的幀會連同正在透出來的
  // 那圈開口一起壓掉。放手會吸附到整數幀，靜止時 blend=0，仍用當下這幀，邊緣暗部才貼齊。
  const rim = layout.garment.rimShadow;
  if (rim && state.progress > 0.02 && typeof context.filter === "string") {
    const grow = rim * layout.scale;
    const shadowFrame = blend > 0.02 && frames[i + 1] ? frames[i + 1] : frames[i];
    context.save();
    context.filter = `blur(${Math.max(4, grow * 0.9)}px) brightness(${layout.garment.rimDarkness})`;
    context.drawImage(
      shadowFrame,
      layout.offsetX - grow, layout.offsetY - grow,
      dw + grow * 2, dh + grow * 2
    );
    context.restore();
  }
  if (blend > 0.001 && frames[i + 1]) {
    // 較開的幀墊底，較閉的幀壓上去；壓上去的不透明度沿拉鍊軸做成斜坡：
    // 拉鍊頭之前維持溶接值（開口留著），之後補到全滿（開口收掉），
    // 開口的外緣就剛好收在拉鍊頭上。不做斜坡直接硬切的話，兩幀之間沒對齊的
    // 布料會在切線上露出一條橫貫畫面的色階。
    context.drawImage(frames[i + 1], layout.offsetX, layout.offsetY, dw, dh);
    const vertical = layout.garment.axis === "v";
    const band = clamp(state.width * 0.07, 48, 96);
    const steps = 6;
    const start = tip - band / 2;
    const put = (from, to, alpha) => {
      if (alpha <= 0.002 || to <= from) {
        return;
      }
      context.save();
      context.beginPath();
      context.rect(
        vertical ? 0 : from, vertical ? from : 0,
        vertical ? state.width : to - from, vertical ? to - from : state.height
      );
      context.clip();
      context.globalAlpha = alpha;
      context.drawImage(frames[i], layout.offsetX, layout.offsetY, dw, dh);
      context.restore();
    };
    put(0, start, 1 - blend);
    for (let s = 0; s < steps; s++) {
      put(start + (band / steps) * s, start + (band / steps) * (s + 1), Math.max(1 - blend, (s + 0.5) / steps));
    }
    put(start + band, vertical ? state.height : state.width, 1);
  } else {
    context.drawImage(frames[i], layout.offsetX, layout.offsetY, dw, dh);
  }
  drawSlider(layout, tip);
  // 門襟蓋布疊在拉鍊頭上面：閉合時拉鍊頭有一半收在布底下，一拉就露出來。
  // 只有第 0 段有意義（那是唯一有蓋布的幀），淡出跟著第 0 幀走。
  const flap = state.flapImages.get(state.garment);
  if (flap && i === 0 && blend < 0.999) {
    context.globalAlpha = 1 - blend;
    context.drawImage(flap, layout.offsetX, layout.offsetY, dw, dh);
    context.globalAlpha = 1;
  }
}

function requestDraw() {
  if (!state.renderQueued) {
    state.renderQueued = true;
    window.requestAnimationFrame(drawScene);
  }
}

// 音效素材：BigSoundBank「Zip #7」(CC0 / Joseph SARDIN) 取穩定段做成 1 秒無縫循環。
// 用循環取樣 + playbackRate 跟拉動速度走：慢拉聽得到一顆顆齒，快拉才連成「滋」一聲。
// 取樣本身就是真實拉鍊拉完全長約 1 秒，所以 playbackRate 直接等於「進度/秒」。
const zip = { ctx: null, bytes: null, buffer: null, node: null, gain: null, idleId: 0, lastAt: 0 };

// 先抓檔案，但 AudioContext 等第一次拖曳（使用者手勢）才建，避免瀏覽器自動播放警告
fetch("assets/zip-loop.wav")
  .then((response) => response.arrayBuffer())
  .then((bytes) => { zip.bytes = bytes; })
  .catch(() => { /* 沒音效不影響互動，靜音就好 */ });

function zipSoundStop() {
  if (!zip.node) {
    return;
  }
  const node = zip.node;
  zip.node = null;
  zip.gain.gain.setTargetAtTime(0, zip.ctx.currentTime, 0.015);
  node.stop(zip.ctx.currentTime + 0.1);
}

// 進度每變動一次餵一次速度；停手 90ms 內沒有新變動就淡出（拉鍊不動就沒聲音）
function zipSound(delta) {
  if (!zip.ctx && zip.bytes) {
    zip.ctx = new (window.AudioContext || window.webkitAudioContext)();
    zip.ctx.decodeAudioData(zip.bytes).then((buffer) => { zip.buffer = buffer; }).catch(() => {});
    zip.bytes = null;
  }
  if (!zip.buffer) {
    return;
  }
  const now = performance.now();
  const speed = Math.abs(delta) / clamp((now - zip.lastAt) / 1000, 0.008, 0.1);
  zip.lastAt = now;
  window.clearTimeout(zip.idleId);
  if (speed < 0.06) {
    zipSoundStop();
    return;
  }
  if (zip.ctx.state === "suspended") {
    void zip.ctx.resume();
  }
  if (!zip.node) {
    zip.gain = zip.ctx.createGain();
    zip.gain.connect(zip.ctx.destination);
    zip.node = zip.ctx.createBufferSource();
    zip.node.buffer = zip.buffer;
    zip.node.loop = true;
    zip.node.connect(zip.gain);
    // 起點隨機：連續拉好幾次不會每次都聽到同一段，少了罐頭味
    zip.node.start(0, Math.random() * zip.buffer.duration);
  }
  zip.gain.gain.setTargetAtTime(0.9, zip.ctx.currentTime, 0.02);
  zip.node.playbackRate.setTargetAtTime(clamp(speed, 0.35, 3), zip.ctx.currentTime, 0.03);
  zip.idleId = window.setTimeout(zipSoundStop, 90);
}

function setProgress(progress) {
  const previous = state.progress;
  state.progress = clamp(progress, 0, 1);
  zipSound(state.progress - previous);
  // 閉合瞬間就先換好下一批內容：畫面被布料蓋住時背後載圖，拉開前已就緒
  if (previous > 0.008 && state.progress <= 0.008) {
    void chooseContent();
  }
  requestDraw();
}

// 放手時把進度吸附到最近的幀：靜止畫面永遠是單一清晰幀，不會停在半透明重影上
function snapToNearestFrame() {
  const frames = state.garmentImages.get(state.garment);
  if (!frames) {
    return;
  }
  const last = frames.length - 1;
  const from = clamp(state.progress, 0, 1);
  const target = Math.round(from * last) / last;
  window.cancelAnimationFrame(state.snapId);
  if (Math.abs(target - from) < 0.001) {
    return;
  }
  const startTime = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - startTime) / 130);
    const eased = k * k * (3 - 2 * k);
    setProgress(from + (target - from) * eased);
    if (k < 1) {
      state.snapId = window.requestAnimationFrame(step);
    }
  };
  state.snapId = window.requestAnimationFrame(step);
}

function setProgressFromPointer(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const layout = getLayout();
  const pos = layout.garment.axis === "v" ? clientY - rect.top : clientX - rect.left;
  setProgress(progressFromPointer(pos, layout));
}

function isNearSlider(clientX, clientY, slack = 1) {
  const rect = canvas.getBoundingClientRect();
  const layout = getLayout();
  const tip = tipScreen(layout);
  const line = lineAt(layout);
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = layout.garment.axis === "v" ? x - line : x - tip;
  const dy = layout.garment.axis === "v" ? y - tip : y - line;
  return Math.abs(dx) <= 96 * slack && Math.abs(dy) <= 96 * slack;
}

canvas.addEventListener("pointerdown", (event) => {
  if (!isNearSlider(event.clientX, event.clientY)) {
    return;
  }
  state.dragging = true;
  window.cancelAnimationFrame(state.snapId);
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
  setProgressFromPointer(event.clientX, event.clientY);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) {
    return;
  }
  setProgressFromPointer(event.clientX, event.clientY);
  event.preventDefault();
});

function releasePointer(event) {
  if (!state.dragging) {
    return;
  }
  state.dragging = false;
  canvas.classList.remove("is-dragging");
  if (event && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  snapToNearestFrame();
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

function resize() {
  state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  requestDraw();
}

function cancelPendingContent() {
  if (state.pendingContent) {
    if (typeof state.pendingContent.cancelLoad === "function") {
      state.pendingContent.cancelLoad();
    } else {
      state.pendingContent.removeAttribute("src");
      state.pendingContent.remove();
      state.pendingContent = null;
    }
  }
}

function tryContentUrl(url, key, generation, timeoutMs) {
  return new Promise((resolve) => {
    if (generation !== state.contentGeneration) {
      resolve(false);
      return;
    }
    cancelPendingContent();
    const image = document.createElement("img");
    image.alt = "拉鍊後方內容";
    image.decoding = "async";
    state.pendingContent = image;
    contentLayer.append(image);
    let settled = false;

    const finish = (success) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (!success || generation !== state.contentGeneration) {
        image.removeAttribute("src");
        image.remove();
        if (state.pendingContent === image) {
          state.pendingContent = null;
        }
        resolve(false);
        return;
      }
      const oldImage = state.activeContent;
      state.activeContent = image;
      state.pendingContent = null;
      state.lastContentKey = key;
      image.style.opacity = "1";
      // MJPEG 串流可能在載入成功後才斷線：掛掉就移除自己，露出下面的保底圖
      image.onerror = () => {
        image.remove();
        if (state.activeContent === image) {
          state.activeContent = null;
        }
      };
      if (oldImage && oldImage !== image) {
        oldImage.removeAttribute("src");
        oldImage.remove();
      }
      resolve(true);
    };

    const timer = window.setTimeout(() => finish(false), Math.max(1, timeoutMs));
    image.cancelLoad = () => finish(false);
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function loadLocalContent(generation) {
  const order = shuffleIndexes(LOCAL_CONTENTS.length, state.lastLocalIndex);
  for (const index of order) {
    if (generation !== state.contentGeneration) {
      return false;
    }
    const url = LOCAL_CONTENTS[index];
    const loaded = await tryContentUrl(url, `local:${index}`, generation, NETWORK_TIMEOUT_MS);
    if (loaded) {
      state.lastLocalIndex = index;
      return true;
    }
  }
  return false;
}

function prefetchGif() {
  // 在背景預抓下一張 GIF，下次要用時直接拿已載好的元素瞬間換圖
  const stamp = Date.now();
  const img = new Image();
  img.src = `https://cataas.com/cat/gif?t=${stamp}`;
  state.nextGif = { img, stamp };
}

function adoptContentImage(image, key) {
  cancelPendingContent();
  image.alt = "拉鍊後方內容";
  const oldImage = state.activeContent;
  contentLayer.append(image);
  state.activeContent = image;
  state.lastContentKey = key;
  image.style.opacity = "1";
  image.onerror = () => {
    image.remove();
    if (state.activeContent === image) {
      state.activeContent = null;
    }
  };
  if (oldImage && oldImage !== image) {
    oldImage.removeAttribute("src");
    oldImage.remove();
  }
}

async function loadGifContent(generation) {
  const pre = state.nextGif;
  state.nextGif = null;
  prefetchGif();
  if (pre && pre.img.complete && pre.img.naturalWidth > 0) {
    if (generation !== state.contentGeneration) {
      return false;
    }
    adoptContentImage(pre.img, `gif:${pre.stamp}`);
    return true;
  }
  // 沒有預抓好的才現抓；cataas 大 GIF 常要 5–10 秒，換圖發生在閉合期間不影響體驗
  const url = `https://cataas.com/cat/gif?t=${Date.now()}`;
  const loaded = await tryContentUrl(url, `gif:${Date.now()}`, generation, 12000);
  return loaded || loadLocalContent(generation);
}

async function loadCctvContent(generation) {
  const deadline = performance.now() + NETWORK_TIMEOUT_MS;
  const order = shuffleIndexes(CCTV_STREAMS.length, state.lastCctvIndex);
  for (const index of order) {
    if (generation !== state.contentGeneration) {
      return false;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      break;
    }
    const separator = CCTV_STREAMS[index].includes("?") ? "&" : "?";
    const url = `${CCTV_STREAMS[index]}${separator}t=${Date.now()}`;
    const loaded = await tryContentUrl(url, `cctv:${index}:${Date.now()}`, generation, remaining);
    if (loaded) {
      state.lastCctvIndex = index;
      return true;
    }
  }
  return loadLocalContent(generation);
}

async function chooseContent() {
  const generation = ++state.contentGeneration;
  let source = state.source;
  if (source === "mixed") {
    const choices = ["local", "gif", "cctv"];
    source = choices[Math.floor(Math.random() * choices.length)];
  }
  if (source === "gif") {
    await loadGifContent(generation);
  } else if (source === "cctv") {
    await loadCctvContent(generation);
  } else {
    await loadLocalContent(generation);
  }
}

function updateGestureCursor(point, pinched, near) {
  gestureCursor.style.display = "block";
  gestureCursor.style.left = `${point.x}px`;
  gestureCursor.style.top = `${point.y}px`;
  gestureCursor.classList.toggle("is-near", near && !state.gestureGrabbed);
  gestureCursor.classList.toggle("is-grabbed", state.gestureGrabbed);
  gestureCursor.classList.toggle("is-pinched", pinched && !state.gestureGrabbed);
}

function stopGestureMode() {
  state.gestureGeneration += 1;
  window.cancelAnimationFrame(state.gestureAnimationId);
  state.gestureAnimationId = 0;
  state.gestureGrabbed = false;
  state.gestureWasPinched = false;
  state.gestureCursorX = -1;
  state.gestureCursorY = -1;
  gestureCursor.style.display = "none";
  preview.style.display = "none";
  if (state.gestureStream) {
    for (const track of state.gestureStream.getTracks()) {
      track.stop();
    }
    state.gestureStream = null;
  }
  preview.srcObject = null;
  if (state.gestureLandmarker && typeof state.gestureLandmarker.close === "function") {
    state.gestureLandmarker.close();
  }
  state.gestureLandmarker = null;
  state.lastVideoTime = -1;
}

function renderGesture(generation) {
  if (generation !== state.gestureGeneration || state.gestureMode !== "on") {
    return;
  }
  if (preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && preview.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = preview.currentTime;
    const result = state.gestureLandmarker.detectForVideo(preview, performance.now());
    const landmarks = result.landmarks && result.landmarks[0];
    if (landmarks) {
      const thumb = landmarks[4];
      const index = landmarks[8];
      const rawX = (1 - index.x) * state.width;
      const rawY = index.y * state.height;
      // 輕度平滑游標，減少骨架抖動
      if (state.gestureCursorX < 0) {
        state.gestureCursorX = rawX;
        state.gestureCursorY = rawY;
      } else {
        state.gestureCursorX += (rawX - state.gestureCursorX) * 0.45;
        state.gestureCursorY += (rawY - state.gestureCursorY) * 0.45;
      }
      const point = { x: state.gestureCursorX, y: state.gestureCursorY };
      // 捏合用「指距／手掌寬」比例判斷，手離鏡頭遠近都準；加遲滯避免拖曳中途誤判放開
      const handSpan = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y);
      const pinchRatio = Math.hypot(thumb.x - index.x, thumb.y - index.y) / Math.max(handSpan, 1e-4);
      const pinched = state.gestureWasPinched ? pinchRatio < 0.6 : pinchRatio < 0.42;
      const near = isNearSlider(point.x, point.y, 1.6);
      // 捏著移進拉鍊頭附近也能抓住，不要求「先靠近才捏」
      if (pinched && !state.gestureGrabbed && near) {
        state.gestureGrabbed = true;
        window.cancelAnimationFrame(state.snapId);
      }
      if (!pinched) {
        if (state.gestureGrabbed) {
          snapToNearestFrame();
        }
        state.gestureGrabbed = false;
      }
      if (pinched && state.gestureGrabbed) {
        setProgressFromPointer(point.x, point.y);
      }
      state.gestureWasPinched = pinched;
      updateGestureCursor(point, pinched, near);
    } else {
      gestureCursor.style.display = "none";
      state.gestureCursorX = -1;
      state.gestureCursorY = -1;
      state.gestureGrabbed = false;
      state.gestureWasPinched = false;
    }
  }
  state.gestureAnimationId = window.requestAnimationFrame(() => renderGesture(generation));
}

async function startGestureMode() {
  stopGestureMode();
  state.gestureMode = "on";
  const generation = ++state.gestureGeneration;
  try {
    shell.showLoading("正在開啟相機與手勢辨識，請稍候…");
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw new Error("mediaDevices unavailable");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false
    });
    if (generation !== state.gestureGeneration || state.gestureMode !== "on") {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    state.gestureStream = stream;
    preview.srcObject = stream;
    await preview.play();
    // 手勢模式預設關閉，因此 MediaPipe 模組也延遲到使用者明確開啟後才載入。
    const { FilesetResolver, HandLandmarker } = await import("../../libs/mediapipe/vision_bundle.mjs");
    const fileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/hand_landmarker.task" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35
    });
    if (generation !== state.gestureGeneration || state.gestureMode !== "on") {
      landmarker.close();
      return;
    }
    state.gestureLandmarker = landmarker;
    preview.style.display = "block";
    shell.hideLoading();
    renderGesture(generation);
  } catch (error) {
    console.error(error);
    stopGestureMode();
    shell.showError(CAMERA_ERROR);
  }
}

shell.addParam({
  type: "select",
  key: "garment",
  label: "衣服",
  value: state.garment,
  options: [
    { value: "jeans", label: "牛仔褲" },
    { value: "bag", label: "包包" }
  ],
  onChange(value) {
    state.garment = value;
    setProgress(0);
    requestDraw();
  }
});

shell.addParam({
  type: "select",
  key: "source",
  label: "內容來源",
  value: state.source,
  options: [
    { value: "mixed", label: "隨機混合" },
    { value: "local", label: "本地趣圖包" },
    { value: "gif", label: "迷因動圖（連網）" },
    { value: "cctv", label: "即時監視器（連網）" }
  ],
  onChange(value) {
    state.source = value;
    void chooseContent();
  }
});

shell.addParam({
  type: "select",
  key: "gesture",
  label: "手勢模式",
  value: state.gestureMode,
  options: [
    { value: "off", label: "關" },
    { value: "on", label: "開" }
  ],
  onChange(value) {
    state.gestureMode = value;
    if (value === "on") {
      void startGestureMode();
    } else {
      stopGestureMode();
      state.gestureMode = "off";
    }
  }
});

shell.addButton({
  label: "重置",
  onClick() {
    state.dragging = false;
    canvas.classList.remove("is-dragging");
    // 已閉合時 setProgress 不會觸發換圖，這裡補一次
    if (state.progress <= 0.008) {
      void chooseContent();
    }
    setProgress(0);
  }
});

async function start() {
  try {
    shell.showLoading("正在準備拉鍊素材…");
    const garmentEntries = Object.entries(GARMENTS);
    const loaded = await Promise.all(garmentEntries.map(async ([key, garment]) => {
      const [frames, slider, flap] = await Promise.all([
        Promise.all(garment.frames.map(loadImage)),
        loadImage(garment.sliderUrl),
        garment.flapUrl ? loadImage(garment.flapUrl) : null
      ]);
      return [key, frames, slider, flap];
    }));
    for (const [key, frames, slider, flap] of loaded) {
      state.garmentImages.set(key, frames);
      state.sliderImages.set(key, slider);
      if (flap) {
        state.flapImages.set(key, flap);
      }
    }
    resize();
    // 保底圖層：串流斷線或內容載入失敗時，開口後面永遠有東西可看
    const backstop = document.createElement("img");
    backstop.src = LOCAL_CONTENTS[Math.floor(Math.random() * LOCAL_CONTENTS.length)];
    backstop.style.opacity = "1";
    contentLayer.prepend(backstop);
    prefetchGif();
    await chooseContent();
    shell.hideLoading();
    requestDraw();
  } catch (error) {
    console.error(error);
    shell.showError("拉鍊素材載入失敗，請確認專案檔案完整後重新整理。 ");
  }
}

window.addEventListener("resize", resize);
window.addEventListener("pagehide", () => {
  state.contentGeneration += 1;
  cancelPendingContent();
  stopGestureMode();
});

start();
