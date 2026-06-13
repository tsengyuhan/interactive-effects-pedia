import { FilesetResolver, ImageSegmenter } from "../../libs/mediapipe/vision_bundle.mjs";

// 草稿紙人像：webcam 經人像分割去背後，把人的輪廓「畫」在方格稿紙上，
// 每一格依該區域明暗用鉛筆交叉線塗陰影；拖曳格線可把稿紙撕開一條縫偷看真實畫面。

const shell = Shell.init({ id: "sketch-portrait" });
const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";

// 顯示用主畫布
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");

// 稿紙底圖（紙紋＋格線，靜態，尺寸變動時重建）
const paperCanvas = document.createElement("canvas");
const paperCtx = paperCanvas.getContext("2d");

// 每幀重畫的「稿紙＋鉛筆素描」不透明圖層，合成時用它蓋住真實畫面、只在裂縫露出
const sketchCanvas = document.createElement("canvas");
const sketchCtx = sketchCanvas.getContext("2d");

// 取樣畫布：縮到格子解析度，一格一像素，用來取每格平均亮度
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

const HATCH_ANGLES = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, 0, Math.PI / 8]; // 5 層交叉線方向
const MAX_LEVEL = HATCH_ANGLES.length;
const PAPER_COLOR = "#f1ecdd";

const state = {
  width: 1,
  height: 1,
  cell: 18,        // 格子大小（px），同時是稿紙方格邊長——可調參數
  density: 1,      // 線條濃度增益——可調參數
  cols: 1,
  rows: 1,
  cur: null,       // 目前每格陰影強度（平滑後）
  target: null,    // 每格目標陰影強度
  lastVideoTime: -1,
  hasVideoFrame: false,
  animationId: 0,
  // 撕縫互動狀態
  seam: null,      // { orient: "v"|"h", pos, gap }
  pressed: false,
  startX: 0,
  startY: 0
};

canvas.style.position = "absolute";
canvas.style.inset = "0";
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";
canvas.style.cursor = "grab";
video.muted = true;
video.playsInline = true;
video.style.display = "none";
shell.container.style.overflow = "hidden";
shell.container.style.background = "#dcd6c4";
shell.container.append(video, canvas);

shell.addParam({
  type: "range",
  key: "cell",
  label: "格子大小",
  min: 10,
  max: 36,
  step: 1,
  value: state.cell,
  onChange(value) {
    state.cell = value;
    buildGrid();
  }
});

shell.addParam({
  type: "range",
  key: "density",
  label: "線條濃度",
  min: 50,
  max: 180,
  step: 5,
  value: 100,
  onChange(value) {
    state.density = value / 100;
  }
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// 以格座標與層數產生穩定的偽隨機（同一格每幀抖動一致，避免閃爍）
function hashRandom(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function resize() {
  state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  canvas.width = Math.floor(state.width);
  canvas.height = Math.floor(state.height);
  sketchCanvas.width = canvas.width;
  sketchCanvas.height = canvas.height;
  buildGrid();
}

// 依容器尺寸與格子大小重算格數、配置陰影緩衝、重建稿紙底圖
function buildGrid() {
  state.cols = Math.max(1, Math.ceil(state.width / state.cell));
  state.rows = Math.max(1, Math.ceil(state.height / state.cell));
  const count = state.cols * state.rows;
  state.cur = new Float32Array(count);
  state.target = new Float32Array(count);
  sampleCanvas.width = state.cols;
  sampleCanvas.height = state.rows;
  buildPaper();
}

// 稿紙底圖：暖白紙底＋細紙紋＋淡藍格線＋左側紅邊線
function buildPaper() {
  paperCanvas.width = canvas.width;
  paperCanvas.height = canvas.height;
  const w = paperCanvas.width;
  const h = paperCanvas.height;

  paperCtx.fillStyle = PAPER_COLOR;
  paperCtx.fillRect(0, 0, w, h);

  // 紙紋：稀疏深淺斑點，一次性產生
  const grains = Math.min(20000, Math.floor((w * h) / 90));
  for (let i = 0; i < grains; i += 1) {
    const gx = Math.random() * w;
    const gy = Math.random() * h;
    const dark = Math.random() < 0.5;
    paperCtx.fillStyle = dark
      ? "rgba(120, 110, 86, 0.05)"
      : "rgba(255, 255, 255, 0.06)";
    paperCtx.fillRect(gx, gy, 1.4, 1.4);
  }

  // 方格線
  paperCtx.strokeStyle = "rgba(120, 140, 170, 0.28)";
  paperCtx.lineWidth = 1;
  paperCtx.beginPath();
  for (let x = 0; x <= state.cols; x += 1) {
    const px = Math.round(x * state.cell) + 0.5;
    paperCtx.moveTo(px, 0);
    paperCtx.lineTo(px, h);
  }
  for (let y = 0; y <= state.rows; y += 1) {
    const py = Math.round(y * state.cell) + 0.5;
    paperCtx.moveTo(0, py);
    paperCtx.lineTo(w, py);
  }
  paperCtx.stroke();

  // 左側紅色邊線，像真的稿紙
  paperCtx.strokeStyle = "rgba(196, 92, 78, 0.45)";
  paperCtx.lineWidth = 1.5;
  paperCtx.beginPath();
  const margin = Math.round(state.cell * 1.5) + 0.5;
  paperCtx.moveTo(margin, 0);
  paperCtx.lineTo(margin, h);
  paperCtx.stroke();
}

// 把鏡像後的影像縮到格解析度，取每格亮度；並用人像分割遮罩決定哪些格屬於人
function updateTargets(segmenter, now) {
  sampleCtx.save();
  sampleCtx.translate(state.cols, 0);
  sampleCtx.scale(-1, 1); // 與顯示一致：鏡像
  sampleCtx.drawImage(video, 0, 0, state.cols, state.rows);
  sampleCtx.restore();
  const pixels = sampleCtx.getImageData(0, 0, state.cols, state.rows).data;

  let mask = null;
  let maskW = 0;
  let maskH = 0;
  const result = segmenter.segmentForVideo(video, now);
  if (result && result.confidenceMasks && result.confidenceMasks[0]) {
    const mp = result.confidenceMasks[0];
    maskW = mp.width;
    maskH = mp.height;
    mask = mp.getAsFloat32Array(); // 0..1，人像信心值
  }

  for (let row = 0; row < state.rows; row += 1) {
    for (let col = 0; col < state.cols; col += 1) {
      const idx = row * state.cols + col;
      const p = idx * 4;
      const lum = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;

      let coverage = 1;
      if (mask) {
        // 顯示為鏡像，遮罩取原始座標需把 x 翻回去
        const mx = Math.min(maskW - 1, Math.floor((1 - (col + 0.5) / state.cols) * maskW));
        const my = Math.min(maskH - 1, Math.floor(((row + 0.5) / state.rows) * maskH));
        const conf = mask[my * maskW + mx];
        coverage = clamp((conf - 0.4) / 0.4, 0, 1); // 0.4 以下視為背景，留白
      }

      // 人像區域：越暗畫越濃；亮部仍留一點淡影讓輪廓成形
      const shade = coverage * (0.2 + 0.8 * (1 - lum)) * state.density;
      state.target[idx] = clamp(shade, 0, 1);
    }
  }

  if (result && typeof result.close === "function") {
    result.close();
  }
}

// 在某格內沿指定角度加入幾條抖動的平行短線（堆進目前路徑，最後統一 stroke）
function addHatch(x, y, size, angle, seed) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;
  const half = size * 0.62;
  for (let k = -1; k <= 1; k += 1) {
    const r1 = hashRandom(seed + k * 7.3);
    const r2 = hashRandom(seed + k * 13.1 + 4.2);
    const offset = k * (size / 3) + (r1 - 0.5) * size * 0.18;
    const ox = perpX * offset;
    const oy = perpY * offset;
    const len1 = half * (0.85 + r1 * 0.3);
    const len2 = half * (0.85 + r2 * 0.3);
    sketchCtx.moveTo(cx + ox - dirX * len1, cy + oy - dirY * len1);
    sketchCtx.lineTo(cx + ox + dirX * len2, cy + oy + dirY * len2);
  }
}

// 重畫「稿紙＋素描」圖層：先鋪底圖，再一層方向畫一次（堆疊出深淺）
function drawSketch() {
  sketchCtx.setTransform(1, 0, 0, 1, 0, 0);
  sketchCtx.clearRect(0, 0, sketchCanvas.width, sketchCanvas.height);
  sketchCtx.drawImage(paperCanvas, 0, 0);

  sketchCtx.strokeStyle = "rgba(38, 36, 30, 0.45)";
  sketchCtx.lineWidth = 1;
  sketchCtx.lineCap = "round";

  for (let layer = 0; layer < MAX_LEVEL; layer += 1) {
    const angle = HATCH_ANGLES[layer];
    sketchCtx.beginPath();
    let any = false;
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const idx = row * state.cols + col;
        const level = Math.round(state.cur[idx] * MAX_LEVEL);
        if (level > layer) {
          addHatch(col * state.cell, row * state.cell, state.cell, angle, idx * 3.7 + layer * 17.0);
          any = true;
        }
      }
    }
    if (any) {
      sketchCtx.stroke();
    }
  }
}

function drawMirroredVideo() {
  context.save();
  context.translate(state.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, state.width, state.height);
  context.restore();
}

// 把裂縫兩側的稿紙錯開繪製，中間露出底下的真實畫面
function composite() {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, state.width, state.height);
  drawMirroredVideo();

  const seam = state.seam;
  if (!seam || seam.gap < 1) {
    context.drawImage(sketchCanvas, 0, 0);
    return;
  }

  const g = seam.gap;
  const half = g / 2;
  const W = state.width;
  const H = state.height;
  if (seam.orient === "v") {
    const L = seam.pos;
    if (L > 0) {
      context.drawImage(sketchCanvas, 0, 0, L, H, -half, 0, L, H);
    }
    if (W - L > 0) {
      context.drawImage(sketchCanvas, L, 0, W - L, H, L + half, 0, W - L, H);
    }
    paintSeamShadow(L - half, 0, L + half, H, true);
  } else {
    const T = seam.pos;
    if (T > 0) {
      context.drawImage(sketchCanvas, 0, 0, W, T, 0, -half, W, T);
    }
    if (H - T > 0) {
      context.drawImage(sketchCanvas, 0, T, W, H - T, 0, T + half, W, H - T);
    }
    paintSeamShadow(0, T - half, W, T + half, false);
  }
}

// 裂縫兩邊各畫一道柔和陰影，營造紙張被掀開的厚度
function paintSeamShadow(x1, y1, x2, y2, vertical) {
  context.save();
  const depth = 18;
  if (vertical) {
    let grad = context.createLinearGradient(x1, 0, x1 - depth, 0);
    grad.addColorStop(0, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = grad;
    context.fillRect(x1 - depth, 0, depth, state.height);
    grad = context.createLinearGradient(x2, 0, x2 + depth, 0);
    grad.addColorStop(0, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = grad;
    context.fillRect(x2, 0, depth, state.height);
  } else {
    let grad = context.createLinearGradient(0, y1, 0, y1 - depth);
    grad.addColorStop(0, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = grad;
    context.fillRect(0, y1 - depth, state.width, depth);
    grad = context.createLinearGradient(0, y2, 0, y2 + depth);
    grad.addColorStop(0, "rgba(0,0,0,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = grad;
    context.fillRect(0, y2, state.width, depth);
  }
  context.restore();
}

function updateSeam() {
  const seam = state.seam;
  if (!seam) {
    return;
  }
  if (!state.pressed) {
    seam.gap *= 0.82; // 放開後裂縫慢慢闔上
    if (seam.gap < 1) {
      state.seam = null;
    }
  }
}

function smoothDarkness() {
  const cur = state.cur;
  const target = state.target;
  for (let i = 0; i < cur.length; i += 1) {
    cur[i] += (target[i] - cur[i]) * 0.35;
  }
}

function render(segmenter) {
  const now = performance.now();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (!state.hasVideoFrame) {
      state.hasVideoFrame = true;
      shell.hideLoading();
    }
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      updateTargets(segmenter, now);
    }
    smoothDarkness();
    drawSketch();
    updateSeam();
    composite();
  }
  state.animationId = window.requestAnimationFrame(() => render(segmenter));
}

// ---- 撕縫互動（滑鼠＋觸控通用的 pointer 事件）----
function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (state.width / rect.width),
    y: (event.clientY - rect.top) * (state.height / rect.height)
  };
}

canvas.addEventListener("pointerdown", (event) => {
  const pos = pointerPos(event);
  state.pressed = true;
  state.startX = pos.x;
  state.startY = pos.y;
  state.seam = null; // 方向待第一段位移決定
  canvas.style.cursor = "grabbing";
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.pressed) {
    return;
  }
  const pos = pointerPos(event);
  const dx = pos.x - state.startX;
  const dy = pos.y - state.startY;
  if (!state.seam) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) {
      return;
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      // 往左右拖 → 沿垂直格線撕開
      const pos2 = clamp(Math.round(state.startX / state.cell) * state.cell, 0, state.width);
      state.seam = { orient: "v", pos: pos2, gap: 0 };
    } else {
      const pos2 = clamp(Math.round(state.startY / state.cell) * state.cell, 0, state.height);
      state.seam = { orient: "h", pos: pos2, gap: 0 };
    }
  }
  if (state.seam.orient === "v") {
    state.seam.gap = clamp(Math.abs(dx) * 1.6, 0, state.width * 0.72);
  } else {
    state.seam.gap = clamp(Math.abs(dy) * 1.6, 0, state.height * 0.72);
  }
});

function endPress() {
  state.pressed = false;
  canvas.style.cursor = "grab";
}
canvas.addEventListener("pointerup", endPress);
canvas.addEventListener("pointercancel", endPress);

async function setupCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("mediaDevices unavailable");
  }
  const request = navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720 },
    audio: false
  });
  const timeout = new Promise((resolve, reject) => {
    window.setTimeout(() => {
      reject(new Error("camera permission timeout"));
    }, 20000);
  });
  const stream = await Promise.race([request, timeout]);
  video.srcObject = stream;
  await video.play();
}

async function start() {
  try {
    shell.showLoading("正在開啟相機並載入人像模型，請稍候…");
    resize();
    await setupCamera();
    const fileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/selfie_segmenter.tflite" },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true
    });
    render(segmenter);
  } catch (error) {
    console.error(error);
    shell.showError(errorMessage);
  }
}

window.addEventListener("resize", resize);
window.addEventListener("pagehide", () => {
  window.cancelAnimationFrame(state.animationId);
  const stream = video.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
});

start();
