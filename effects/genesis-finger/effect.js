import { FilesetResolver, HandLandmarker, ImageSegmenter } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "genesis-finger" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
// webcam 鏡像畫面與去背遮罩各用一張離屏 canvas，最後合成只露出手（或整個人）。
const mirrorCanvas = document.createElement("canvas");
const mirrorContext = mirrorCanvas.getContext("2d");
const maskCanvas = document.createElement("canvas");
const maskContext = maskCanvas.getContext("2d");
const shapeCanvas = document.createElement("canvas");
// shapeContext 每幀被 getImageData 回讀，明示 willReadFrequently 走較快路徑。
const shapeContext = shapeCanvas.getContext("2d", { willReadFrequently: true });
const cutoutCanvas = document.createElement("canvas");
const cutoutContext = cutoutCanvas.getContext("2d");
const video = document.createElement("video");

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const fingerTips = [4, 8, 12, 16, 20];
const palmIndices = [0, 5, 9, 13, 17];
// 去背參數沿用「文字繩」純手部模式的經驗值：手形多邊形先撐大，再用人像遮罩修回真輪廓。
const cutoutStyle = {
  personThreshold: 0.18,
  wristPadding: 30,
  palmPadding: 70
};

// 五種圖片手的素材；找不到檔案時 onerror 會讓該張維持 ready=false，改用程式畫的備援手。
const HAND_SOURCES = [
  "hand-fresco.png",
  "hand-cartoon.png",
  "hand-cat.png",
  "hand-robot.png",
  "hand-alien.png"
];

let visionFileset = null;
let segmenterPromise = null;
let segmenterRetryAt = 0;     // 失敗後的重試冷卻時間點，避免每幀重建
let segmenterLogged = false;  // 只記一次錯誤，避免 console 每幀洗版

const state = {
  width: 1,
  height: 1,
  lastVideoTime: -1,
  hasVideoFrame: false,
  animationId: 0,
  hands: [],
  personMask: null,
  segmenter: null,
  tracked: [],
  nextTrackId: 1,
  cutoutMode: "hands",
  handScale: 1,
  maxHands: 2
};

// 背景純色（柔和粉膚色），取代原本的土黃牆圖。
const BG_COLOR = "#f2c4bb";

const handAssets = HAND_SOURCES.map((src) => {
  const asset = { img: new Image(), ready: false, tip: { x: 0.06, y: 0.5 } };
  asset.img.onload = () => {
    asset.tip = detectTip(asset.img);
    asset.ready = true;
  };
  asset.img.onerror = () => { asset.ready = false; };
  asset.img.src = src;
  return asset;
});

canvas.style.position = "absolute";
canvas.style.inset = "0";
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";
video.muted = true;
video.playsInline = true;
video.style.display = "none";
shell.container.style.overflow = "hidden";
shell.container.style.background = BG_COLOR;
shell.container.append(video, canvas);

shell.addParam({
  type: "select",
  key: "cutoutMode",
  label: "去背模式",
  value: state.cutoutMode,
  options: [
    { value: "hands", label: "只露出手" },
    { value: "person", label: "整個人" }
  ],
  onChange(value) { state.cutoutMode = value; }
});

shell.addParam({
  type: "range",
  key: "handScale",
  label: "手的大小",
  min: 0.5,
  max: 2,
  step: 0.1,
  value: state.handScale,
  onChange(value) { state.handScale = value; }
});

shell.addParam({
  type: "range",
  key: "maxHands",
  label: "最多可互動手的數量",
  min: 1,
  max: 4,
  step: 1,
  value: state.maxHands,
  onChange(value) { state.maxHands = value; }
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function mirrorPoint(point) {
  // webcam 畫面左右鏡像，互動座標一律用鏡像後的 CSS 像素。
  return { x: (1 - point.x) * state.width, y: point.y * state.height };
}

function analyzeHand(landmarks, index) {
  const points = landmarks.map(mirrorPoint);
  const centroid = palmIndices.reduce(
    (sum, i) => ({ x: sum.x + points[i].x / palmIndices.length, y: sum.y + points[i].y / palmIndices.length }),
    { x: 0, y: 0 }
  );
  return { id: `raw-${index}`, points, indexTip: points[8], centroid };
}

// 掃描圖片最左側的不透明像素當作食指指尖錨點：
// 手一律「食指指向左、手臂往右出界」，所以最左不透明點就是指尖，免得依賴生成時的精準位置。
function detectTip(img) {
  const w = Math.min(img.naturalWidth, 400);
  const h = Math.min(img.naturalHeight, 400);
  if (!w || !h) {
    return { x: 0.06, y: 0.5 };
  }
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (error) {
    // 以 file:// 直開時 canvas 可能被視為跨來源而污染，回退預設錨點即可（已建議改用 start.bat）。
    console.warn("detectTip 取像失敗，改用預設指尖位置", error);
    return { x: 0.06, y: 0.5 };
  }
  for (let x = 0; x < w; x += 1) {
    let sumY = 0;
    let count = 0;
    for (let y = 0; y < h; y += 1) {
      if (data[(y * w + x) * 4 + 3] > 128) {
        sumY += y;
        count += 1;
      }
    }
    if (count > 0) {
      return { x: x / w, y: (sumY / count) / h };
    }
  }
  return { x: 0.06, y: 0.5 };
}

function resize() {
  state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  for (const c of [canvas, mirrorCanvas, maskCanvas, shapeCanvas, cutoutCanvas]) {
    c.width = Math.floor(state.width);
    c.height = Math.floor(state.height);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function drawMirroredVideoTo(targetContext) {
  targetContext.save();
  targetContext.clearRect(0, 0, state.width, state.height);
  targetContext.translate(state.width, 0);
  targetContext.scale(-1, 1);
  targetContext.drawImage(video, 0, 0, state.width, state.height);
  targetContext.restore();
}

// ---- 背景：純色 ----
function drawBackground() {
  context.fillStyle = BG_COLOR;
  context.fillRect(0, 0, state.width, state.height);
}

// ---- 人像遮罩 ----
function readPersonMask(result) {
  if (!result || !result.confidenceMasks || !result.confidenceMasks[0]) {
    return null;
  }
  const mask = result.confidenceMasks[0];
  return { width: mask.width, height: mask.height, data: mask.getAsFloat32Array() };
}

function mirroredPersonMaskAt(mask, x, y) {
  if (!mask) {
    return 0;
  }
  const nx = clamp(x / state.width, 0, 1);
  const ny = clamp(y / state.height, 0, 1);
  const mx = clamp(Math.floor((1 - nx) * mask.width), 0, mask.width - 1);
  const my = clamp(Math.floor(ny * mask.height), 0, mask.height - 1);
  return mask.data[my * mask.width + mx] || 0;
}

// ---- 只露出手：手形多邊形 ∩ 人像遮罩 ∩ 手腕切線 ----
function drawHandShape(hand) {
  if (!hand || hand.points.length < 21) {
    return;
  }
  const palmWidth = distance(hand.points[5], hand.points[17]);
  const lineWidth = clamp(palmWidth * 0.34, 14, 72);
  const fingerLineWidth = lineWidth * 1.22;
  shapeContext.fillStyle = "#ffffff";
  shapeContext.strokeStyle = "#ffffff";
  shapeContext.lineWidth = lineWidth;
  shapeContext.lineCap = "round";
  shapeContext.lineJoin = "round";

  // 手掌多邊形以重心往外撐 palmPadding，把魚際肉與掌根包成超集，多餘部分後面被人像遮罩修掉。
  const rawPalm = palmIndices.map((index) => hand.points[index]);
  const center = {
    x: rawPalm.reduce((s, p) => s + p.x, 0) / rawPalm.length,
    y: rawPalm.reduce((s, p) => s + p.y, 0) / rawPalm.length
  };
  shapeContext.beginPath();
  rawPalm.forEach((p, i) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = p.x + (dx / len) * cutoutStyle.palmPadding;
    const py = p.y + (dy / len) * cutoutStyle.palmPadding;
    if (i === 0) {
      shapeContext.moveTo(px, py);
    } else {
      shapeContext.lineTo(px, py);
    }
  });
  shapeContext.closePath();
  shapeContext.fill();
  shapeContext.stroke();

  const fingers = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  for (const finger of fingers) {
    shapeContext.lineWidth = fingerLineWidth;
    shapeContext.beginPath();
    finger.forEach((index, i) => {
      const p = hand.points[index];
      if (i === 0) {
        shapeContext.moveTo(p.x, p.y);
      } else {
        shapeContext.lineTo(p.x, p.y);
      }
    });
    shapeContext.stroke();
  }
  const fingertipRadius = fingerLineWidth * 0.52;
  for (const tipIndex of fingerTips) {
    const tip = hand.points[tipIndex];
    shapeContext.beginPath();
    shapeContext.arc(tip.x, tip.y, fingertipRadius, 0, Math.PI * 2);
    shapeContext.fill();
  }
}

function getWristCut(hand) {
  const wrist = hand.points[0];
  const palmCenter = [5, 9, 13, 17].reduce(
    (c, i) => ({ x: c.x + hand.points[i].x / 4, y: c.y + hand.points[i].y / 4 }),
    { x: 0, y: 0 }
  );
  const dx = palmCenter.x - wrist.x;
  const dy = palmCenter.y - wrist.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  return { x: wrist.x - nx * cutoutStyle.wristPadding, y: wrist.y - ny * cutoutStyle.wristPadding, nx, ny };
}

function isInsideWristCut(cut, x, y) {
  return (x - cut.x) * cut.nx + (y - cut.y) * cut.ny >= 0;
}

function buildHandMask(mask) {
  maskContext.setTransform(1, 0, 0, 1, 0, 0);
  maskContext.clearRect(0, 0, state.width, state.height);
  if (state.hands.length === 0) {
    return;
  }
  shapeContext.setTransform(1, 0, 0, 1, 0, 0);
  shapeContext.clearRect(0, 0, state.width, state.height);
  for (const hand of state.hands) {
    drawHandShape(hand);
  }
  // 只在所有手的外擴包圍盒內回讀與逐像素運算（手只佔畫面一小塊），畫面越大省越多。
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const hand of state.hands) {
    for (const p of hand.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const pad = cutoutStyle.palmPadding + 24;
  const bx = clamp(Math.floor(minX - pad), 0, maskCanvas.width);
  const by = clamp(Math.floor(minY - pad), 0, maskCanvas.height);
  const bw = clamp(Math.ceil(maxX + pad) - bx, 0, maskCanvas.width - bx);
  const bh = clamp(Math.ceil(maxY + pad) - by, 0, maskCanvas.height - by);
  if (bw < 1 || bh < 1) {
    return;
  }
  const shapePixels = shapeContext.getImageData(bx, by, bw, bh).data;
  const image = maskContext.createImageData(bw, bh);
  const pixels = image.data;
  const wristCuts = state.hands.map(getWristCut);
  for (let yy = 0; yy < bh; yy += 1) {
    for (let xx = 0; xx < bw; xx += 1) {
      const index = (yy * bw + xx) * 4;
      const x = bx + xx;
      const y = by + yy;
      if (shapePixels[index + 3] === 0 || mirroredPersonMaskAt(mask, x, y) < cutoutStyle.personThreshold) {
        continue;
      }
      if (!wristCuts.some((cut) => isInsideWristCut(cut, x, y))) {
        continue;
      }
      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      pixels[index + 3] = 255;
    }
  }
  maskContext.putImageData(image, bx, by);
}

// 整個人模式：直接把低解析的人像信心遮罩鏡像放大到全畫面，比逐像素手形快。
const personMaskCanvas = document.createElement("canvas");
const personMaskContext = personMaskCanvas.getContext("2d");
function buildPersonMask(mask) {
  maskContext.setTransform(1, 0, 0, 1, 0, 0);
  maskContext.clearRect(0, 0, state.width, state.height);
  if (!mask) {
    return;
  }
  personMaskCanvas.width = mask.width;
  personMaskCanvas.height = mask.height;
  const image = personMaskContext.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i] >= cutoutStyle.personThreshold) {
      image.data[i * 4] = 255;
      image.data[i * 4 + 1] = 255;
      image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = 255;
    }
  }
  personMaskContext.putImageData(image, 0, 0);
  // 遮罩對應未鏡像影像，畫到鏡像畫面上要水平翻轉。
  maskContext.save();
  maskContext.translate(state.width, 0);
  maskContext.scale(-1, 1);
  maskContext.imageSmoothingEnabled = true;
  maskContext.drawImage(personMaskCanvas, 0, 0, state.width, state.height);
  maskContext.restore();
}

function drawUserCutout(mask) {
  if (state.cutoutMode === "person") {
    buildPersonMask(mask);
  } else {
    buildHandMask(mask);
  }
  drawMirroredVideoTo(mirrorContext);
  cutoutContext.setTransform(1, 0, 0, 1, 0, 0);
  cutoutContext.clearRect(0, 0, state.width, state.height);
  cutoutContext.drawImage(mirrorCanvas, 0, 0);
  cutoutContext.globalCompositeOperation = "destination-in";
  cutoutContext.drawImage(maskCanvas, 0, 0);
  cutoutContext.globalCompositeOperation = "source-over";

  // 柔和投影讓手像是浮在牆前，貼近壁畫的立體感。
  context.save();
  context.shadowColor = "rgba(30, 20, 8, 0.45)";
  context.shadowBlur = 22;
  context.shadowOffsetY = 10;
  context.drawImage(cutoutCanvas, 0, 0);
  context.restore();
}

// ---- 圖片手追蹤：跨幀最近鄰配對，維持每隻手的隨機風格與接近度 ----
function updateTracked() {
  const detected = state.hands.slice(0, state.maxHands);
  const used = new Set();
  const threshold = Math.min(state.width, state.height) * 0.35;

  for (const track of state.tracked) {
    let best = -1;
    let bestDist = threshold;
    for (let i = 0; i < detected.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const d = distance(track.centroid, detected[i].centroid);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      const hand = detected[best];
      track.centroid = hand.centroid;
      track.tip = { x: lerp(track.tip.x, hand.indexTip.x, 0.5), y: lerp(track.tip.y, hand.indexTip.y, 0.5) };
      track.missing = 0;
      track.retracting = false;
    } else {
      track.missing += 1;
      track.retracting = true; // 沒偵測到 → 進入收回狀態，drawImageHands 會把它滑出畫面
    }
  }
  // 手離開畫面後留緩衝幀讓對面的手滑出再移除（也耐受短暫偵測閃斷、不重抽風格）。
  state.tracked = state.tracked.filter((track) => track.missing <= 12);

  for (let i = 0; i < detected.length; i += 1) {
    if (used.has(i)) {
      continue;
    }
    const hand = detected[i];
    state.tracked.push({
      id: state.nextTrackId++,
      styleIndex: Math.floor(Math.random() * handAssets.length),
      centroid: hand.centroid,
      tip: { x: hand.indexTip.x, y: hand.indexTip.y },
      t: 0,
      missing: 0,
      retracting: false
    });
  }
}

function drawFallbackHand() {
  // 沒有 PNG 素材時的備援手：以指尖為原點、食指指向 -x、前臂往 +x，與素材方位一致（呼叫端已套好旋轉/縮放）。
  context.fillStyle = "#caa46f";
  context.beginPath();
  context.roundRect(70, -75, 520, 150, 60);
  context.fill();
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(95, -26);
  context.lineTo(95, 26);
  context.closePath();
  context.fill();
}

function normalizeAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function drawImageHands() {
  const cx = state.width / 2;
  const cy = state.height / 2;
  for (const track of state.tracked) {
    const tip = track.tip;
    // 以畫面中央為對稱點：圖片手永遠在使用者手的「對角對側」，朝中央伸來，避免同向重疊。
    const dx = tip.x - cx;
    const dy = tip.y - cy;
    const dist = Math.hypot(dx, dy);
    const rhx = dist > 1 ? dx / dist : 1; // 由中央指向使用者指尖的單位向量＝圖片手食指的指向
    const rhy = dist > 1 ? dy / dist : 0;

    // 接近度：使用者指尖越靠近中央，圖片手伸得越進來，滿值時兩指尖相觸。
    const maxDist = Math.min(state.width, state.height) * 0.5;
    const target = track.retracting ? 0 : clamp(1 - dist / maxDist, 0, 1);
    track.t = lerp(track.t, target, 0.25);
    const eased = smoothstep(track.t);

    // 起點在中央的「對側」且在畫面外；隨接近度滑到使用者指尖位置。
    const offDist = Math.hypot(state.width, state.height) * 0.8;
    const startX = cx - rhx * offDist;
    const startY = cy - rhy * offDist;
    const anchorX = lerp(startX, tip.x, eased);
    const anchorY = lerp(startY, tip.y, eased);

    // 素材食指預設指向 -x；旋轉到 rhx,rhy 方向。兩種貼法（不翻/水平翻）取旋轉量較小者，避免手上下顛倒。
    const targetAngle = Math.atan2(rhy, rhx);
    const thetaNoFlip = normalizeAngle(targetAngle - Math.PI);
    const thetaFlip = normalizeAngle(targetAngle);
    const useFlip = Math.abs(thetaFlip) < Math.abs(thetaNoFlip);
    const theta = useFlip ? thetaFlip : thetaNoFlip;
    const sx = useFlip ? -1 : 1;

    const asset = handAssets[track.styleIndex];
    const scaledWidth = state.width * 0.55 * state.handScale;

    context.save();
    context.shadowColor = "rgba(30, 20, 8, 0.4)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
    context.translate(anchorX, anchorY);
    context.rotate(theta);
    if (asset && asset.ready) {
      const scale = scaledWidth / asset.img.width;
      context.scale(sx * scale, scale);
      context.drawImage(asset.img, -asset.tip.x * asset.img.width, -asset.tip.y * asset.img.height);
    } else {
      const scale = scaledWidth / 680;
      context.scale(sx * scale, scale);
      drawFallbackHand();
    }
    context.restore();
  }
}

// 指尖將觸時的微光，呼應《創世紀》觸碰瞬間；畫在真手 cutout 之後才不會被剪影蓋掉。
function drawTouchGlows() {
  for (const track of state.tracked) {
    if (track.t <= 0.9) {
      continue;
    }
    const tip = track.tip;
    const glowAlpha = (track.t - 0.9) / 0.1;
    const radius = 46 * state.handScale;
    const glow = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius);
    glow.addColorStop(0, `rgba(255, 244, 214, ${0.6 * glowAlpha})`);
    glow.addColorStop(1, "rgba(255, 244, 214, 0)");
    context.save();
    context.fillStyle = glow;
    context.beginPath();
    context.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawPrompt() {
  const text = "對著鏡頭伸出你的手";
  const y = state.height - 58;
  context.save();
  context.font = "600 18px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(text).width + 42;
  context.fillStyle = "rgba(40, 28, 12, 0.55)";
  context.beginPath();
  context.roundRect((state.width - width) / 2, y - 22, width, 44, 22);
  context.fill();
  context.fillStyle = "rgba(255, 246, 226, 0.95)";
  context.fillText(text, state.width / 2, y);
  context.restore();
}

function updateHands(landmarker, now) {
  const result = landmarker.detectForVideo(video, now);
  state.hands = (result.landmarks || []).map(analyzeHand);
}

function updateMask(segmenter, now) {
  const result = segmenter.segmentForVideo(video, now);
  const mask = readPersonMask(result);
  state.personMask = mask;
  if (result && typeof result.close === "function") {
    result.close();
  }
  return mask;
}

function ensureSegmenter() {
  if (state.segmenter) {
    return Promise.resolve(state.segmenter);
  }
  if (!segmenterPromise) {
    segmenterPromise = ImageSegmenter.createFromOptions(visionFileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/selfie_segmenter.tflite" },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true
    }).then((segmenter) => {
      state.segmenter = segmenter;
      return segmenter;
    }).catch((error) => {
      segmenterPromise = null; // 失敗時重置，讓之後的冷卻重試能重新建立
      throw error;
    });
  }
  return segmenterPromise;
}

function render(landmarker) {
  const now = performance.now();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (!state.hasVideoFrame) {
      state.hasVideoFrame = true;
      shell.hideLoading();
    }
    let mask = state.personMask;
    // segmenter 尚未就緒時以冷卻時間重試，失敗只記一次 log，避免每幀洗版又能恢復。
    if (!state.segmenter && now >= segmenterRetryAt) {
      segmenterRetryAt = now + 2000;
      ensureSegmenter().catch((error) => {
        if (!segmenterLogged) {
          console.error(error);
          segmenterLogged = true;
        }
      });
    }
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      updateHands(landmarker, now);
      if (state.segmenter) {
        mask = updateMask(state.segmenter, now);
      }
    }

    updateTracked();
    context.clearRect(0, 0, state.width, state.height);
    drawBackground();
    drawImageHands();      // 對面的手畫在使用者手後面，指尖相觸時被真手蓋住更自然
    drawUserCutout(mask);
    drawTouchGlows();      // 觸碰微光畫在最上層，相觸瞬間才看得到火光
    if (state.hands.length === 0) {
      drawPrompt();
    }
  }
  state.animationId = window.requestAnimationFrame(() => render(landmarker));
}

async function setupCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("mediaDevices unavailable");
  }
  const request = navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  const timeout = new Promise((resolve, reject) => {
    window.setTimeout(() => reject(new Error("camera permission timeout")), 20000);
  });
  const stream = await Promise.race([request, timeout]);
  video.srcObject = stream;
  await video.play();
}

async function start() {
  try {
    shell.showLoading("正在開啟相機，請稍候…");
    resize();
    await setupCamera();
    visionFileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const landmarker = await HandLandmarker.createFromOptions(visionFileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/hand_landmarker.task" },
      runningMode: "VIDEO",
      numHands: 4,
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    });
    render(landmarker);
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
