const shell = Shell.init({ id: "zipper-pull" });
const contentLayer = document.createElement("div");
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const preview = document.createElement("video");
const gestureCursor = document.createElement("div");

// 幀序列（AI 生成）：0=閉合、1..5 逐步拉開，開口內部為 alpha 透明，
// 程式依進度在相鄰幀間交叉淡化。apex=每幀開口尖點沿拉鍊軸的原圖座標（素材量測）。
const GARMENTS = {
  jeans: {
    frames: Array.from({ length: 6 }, (_, i) => `assets/frames/jeansv3-${i}.webp`),
    sliderUrl: "assets/slider-jeans2.png",
    axis: "v",
    line: 1024,
    apex: [288, 325, 486, 525, 768, 781],
    // 這條原圖 y 對齊畫面頂端：裁掉腰頭上緣的深色帶，褲身看起來更近更滿
    focusTop: 100
  },
  bag: {
    // 只用到第 9 幀：素材有 12 幀，但 10 以後開口大到吃掉提把、包身變成空殼
    frames: Array.from({ length: 10 }, (_, i) => `assets/frames/bagv3-${i}.webp`),
    sliderUrl: "assets/slider-jeans2.png",
    axis: "h",
    line: 577,
    apex: [200, 350, 500, 650, 800, 950, 1100, 1250, 1400, 1550]
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
  .zipper-content-layer,
  .zipper-content-layer img,
  .zipper-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .zipper-content-layer { overflow: hidden; background: #111; }
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
  const imageWidth = 2048;
  const imageHeight = 1152;
  let scale;
  let offsetX;
  let offsetY;
  if (garment.axis === "v") {
    // 牛仔褲：focusTop 對齊畫面頂端，比例以其下方的圖計算確保滿版
    const focusTop = garment.focusTop || 0;
    scale = Math.max(state.width / imageWidth, state.height / (imageHeight - focusTop));
    offsetX = (state.width - imageWidth * scale) * 0.5;
    offsetY = -focusTop * scale;
  } else {
    // 包包（水平拉鍊）：貼齊畫面寬，直式螢幕上下留邊（drawScene 補底色）
    scale = state.width / imageWidth;
    offsetX = 0;
    offsetY = (state.height - imageHeight * scale) * 0.5;
  }
  const along = garment.axis === "v" ? offsetY : offsetX;
  const apexScreen = garment.apex.map((value) => along + value * scale);
  const lineScreen = garment.axis === "v"
    ? offsetX + garment.line * scale
    : offsetY + garment.line * scale;
  const axisMax = (garment.axis === "v" ? state.height : state.width) - 24;
  return {
    garment,
    scale,
    offsetX,
    offsetY,
    apexScreen,
    lineScreen,
    dragTop: apexScreen[0],
    bottom: Math.min(apexScreen[apexScreen.length - 1], axisMax),
    imageWidth,
    imageHeight
  };
}

// 目前進度對應的開口尖點（相鄰幀 apex 線性內插，跟幀混合同步）
function tipScreen(layout) {
  const a = layout.apexScreen;
  const f = clamp(state.progress, 0, 1) * (a.length - 1);
  const i = Math.floor(f);
  if (i >= a.length - 1) {
    return a[a.length - 1];
  }
  return a[i] + (a[i + 1] - a[i]) * (f - i);
}

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

function drawSlider(layout, tip) {
  const slider = state.sliderImages.get(state.garment);
  if (!slider) {
    return;
  }
  const longest = clamp(state.width * 0.095, 58, 92);
  const ratio = slider.naturalWidth / Math.max(1, slider.naturalHeight);
  let width = longest;
  let height = longest / Math.max(0.35, ratio);
  if (height > longest * 1.25) {
    height = longest * 1.25;
    width = height * ratio;
  }
  context.save();
  if (layout.garment.axis === "v") {
    context.translate(layout.lineScreen, tip);
  } else {
    // 包包：滑塊轉 90°，冠部朝開口側（左）
    context.translate(tip, layout.lineScreen);
    context.rotate(-Math.PI / 2);
  }
  context.shadowColor = "rgba(0, 0, 0, 0.65)";
  context.shadowBlur = 10;
  // 冠部貼著開口尖點（只重疊 8% 高度），不會懸空在開口裡
  context.drawImage(slider, -width * 0.5, -height * 0.08, width, height);
  context.restore();
}

function drawScene() {
  state.renderQueued = false;
  const layout = getLayout();
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
  // 溶接窗依幀密度調整：幀多時相鄰差異小，放寬窗口讓拖曳更順；
  // 幀少時收窄成中段快速溶接，避免長時間停在半透明重影上
  const win = frames.length > 8 ? 0.8 : 0.3;
  const bw = clamp((frac - (1 - win) / 2) / win, 0, 1);
  const blend = bw * bw * (3 - 2 * bw);
  if (blend > 0.001 && frames[i + 1]) {
    context.drawImage(frames[i + 1], layout.offsetX, layout.offsetY, dw, dh);
    context.globalAlpha = 1 - blend;
  }
  context.drawImage(frames[i], layout.offsetX, layout.offsetY, dw, dh);
  context.globalAlpha = 1;
  drawSlider(layout, tipScreen(layout));
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
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const dx = layout.garment.axis === "v" ? x - layout.lineScreen : x - tip;
  const dy = layout.garment.axis === "v" ? y - tip : y - layout.lineScreen;
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
      const [frames, slider] = await Promise.all([
        Promise.all(garment.frames.map(loadImage)),
        loadImage(garment.sliderUrl)
      ]);
      return [key, frames, slider];
    }));
    for (const [key, frames, slider] of loaded) {
      state.garmentImages.set(key, frames);
      state.sliderImages.set(key, slider);
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
