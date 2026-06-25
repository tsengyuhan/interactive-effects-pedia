import { FilesetResolver, HandLandmarker, ImageSegmenter } from "../../libs/mediapipe/vision_bundle.mjs";

// sRGB 0-255 to CIELab for skin segmentation (a/b chroma stable under lighting)
function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const shell = Shell.init({ id: "genesis-finger" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
// webcam 鏡像畫面與去背遮罩各用一張離屏 canvas，最後合成只露出手（或整個人）。
const mirrorCanvas = document.createElement("canvas");
// willReadFrequently：膚色分割每幀 getImageData 讀鏡像像素，提示瀏覽器走 CPU 後端較快。
const mirrorContext = mirrorCanvas.getContext("2d", { willReadFrequently: true });
const maskCanvas = document.createElement("canvas");
const maskContext = maskCanvas.getContext("2d");
const cutoutCanvas = document.createElement("canvas");
const cutoutContext = cutoutCanvas.getContext("2d");
const video = document.createElement("video");

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const palmIndices = [0, 5, 9, 13, 17];
// 去背參數沿用「文字繩」純手部模式的經驗值：手形多邊形先撐大，再用人像遮罩修回真輪廓。
const cutoutStyle = {
  // 「整個人」模式用：羽化帶只留在逼近背景的那端，信心 >personHigh 一律全不透明。
  personLow: 0.05,
  personHigh: 0.22,
  // 「只露出手」膚色分割用 CIELab 容差：a/b 是膚色色度（穩定），L 是亮度（受光照影響大故放寬）。
  // 依「手完整 > 不漏臉」原則，容差偏寬，寧可多納入膚色像素避免切到手。
  skinTolL: 75,
  skinTolA: 20,
  skinTolB: 24
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

function normalizeVector(vector, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0.0001 ? { x: vector.x / length, y: vector.y / length } : fallback;
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
  // 以手腕至食指骨節鏈估算主軸；越靠近指尖權重越高，可降低單一 landmark 抖動的影響。
  const axisIndices = [0, 5, 6, 7, 8];
  const axisWeights = [0.7, 1, 1.2, 1.4];
  const axisVector = { x: 0, y: 0 };
  let axisLength = 0;
  for (let i = 0; i < axisWeights.length; i += 1) {
    const from = points[axisIndices[i]];
    const to = points[axisIndices[i + 1]];
    axisVector.x += (to.x - from.x) * axisWeights[i];
    axisVector.y += (to.y - from.y) * axisWeights[i];
    axisLength += distance(from, to);
  }
  const palmWidth = distance(points[5], points[17]);
  const axisConfidence = palmWidth > 1 ? axisLength / palmWidth : 0;
  return {
    id: `raw-${index}`,
    points,
    indexTip: points[8],
    centroid,
    axis: normalizeVector(axisVector),
    axisConfidence
  };
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
  for (const c of [canvas, mirrorCanvas, maskCanvas, cutoutCanvas]) {
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

// 21 個關鍵點的凸包（Andrew monotone chain）。逆時針，去重端點。
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) {
    return pts;
  }
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source) => {
    const out = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return half(pts).concat(half(pts.slice().reverse()));
}

const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

// ---- 只露出手：純 landmark 手形當去背遮罩，裡面填真實攝影機畫面 ----
// 不交集人像遮罩——segmentation 分不出手與臉，手擋臉時邊界帶會漏臉。手形由掌心凸包＋手指膠囊組成，
// 寬度約一根手指，臉永遠在手形之外，手指間隙也不會漏背景。寬度過細會切到手、過粗會在手緣漏出背後畫面，為調校旋鈕。
function drawHandShape(ctx, hand) {
  if (!hand || hand.points.length < 21) {
    return;
  }
  const palmWidth = distance(hand.points[5], hand.points[17]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 手掌：含拇指根的凸包，只當「範圍框（ROI）」把臉排除在外。框是上界，超出真手的部分會被後面
  // 交集人像遮罩削掉，所以可大膽外推、不怕突角。小指側（尺側）手掌肉（小魚際）沒有對應 landmark，
  // 凸包會從小指根 17 直拉到手腕 0 把整條外緣切掉——沿尺側方向補兩個虛擬點把框撐到真手外。
  const radial = hand.points[5];
  const ulnar = hand.points[17];
  const wrist = hand.points[0];
  // 食指根→小指根＝尺側橫向，長度約 palmWidth。
  const ulnarDir = { x: ulnar.x - radial.x, y: ulnar.y - radial.y };
  const palm = convexHull([
    hand.points[0], hand.points[1], hand.points[2],
    hand.points[5], hand.points[9], hand.points[13], hand.points[17],
    { x: ulnar.x + ulnarDir.x * 0.55, y: ulnar.y + ulnarDir.y * 0.55 }, // 小指根外側
    { x: wrist.x + ulnarDir.x * 0.45, y: wrist.y + ulnarDir.y * 0.45 }  // 手腕外側（小魚際近腕端）
  ]);
  const center = {
    x: palm.reduce((s, p) => s + p.x, 0) / palm.length,
    y: palm.reduce((s, p) => s + p.y, 0) / palm.length
  };
  const pad = palmWidth * 0.32;
  ctx.beginPath();
  palm.forEach((p, i) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = p.x + (dx / len) * pad;
    const py = p.y + (dy / len) * pad;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.closePath();
  ctx.fill();

  // 手指：沿關節畫圓頭粗線；拇指略粗。一根手指約 palmWidth/3。
  for (let f = 0; f < FINGERS.length; f += 1) {
    const finger = FINGERS[f];
    ctx.lineWidth = palmWidth * (f === 0 ? 0.34 : 0.3);
    ctx.beginPath();
    finger.forEach((index, i) => {
      const p = hand.points[index];
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    ctx.stroke();
  }

  // 手腕切線：沿手腕(0)垂直手軸，把手臂側的遮罩切掉，避免交集人像遮罩時手臂連著手顯示成肉球。
  // 旋轉到「手指方向＝+x」的座標系，清掉 x < -keep 的半平面（keep 往手臂側留一點手根不切進手掌）。
  const axis = hand.axis;
  const keep = palmWidth * 0.25;
  const reach = Math.hypot(state.width, state.height);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.translate(wrist.x, wrist.y);
  ctx.rotate(Math.atan2(axis.y, axis.x));
  ctx.fillRect(-keep - reach, -reach, reach, reach * 2);
  ctx.restore();
}

// 只露出手：CIELab 動態膚色分割遮罩。離屏畫每隻手 bbox 內的膚色像素，當 landmark 框內的真實手緣。
const skinCanvas = document.createElement("canvas");
const skinContext = skinCanvas.getContext("2d", { willReadFrequently: true });

// 從 bbox 像素取樣手部掌/指節 landmark 的膚色，回傳 CIELab 中心（中位數抗陰影雜點）；
// 避開指尖（指甲）與最末指節。ox/oy 是 bbox 在畫面中的左上原點。
function sampleSkin(hand, src, bw, bh, ox, oy) {
  const idxs = [0, 1, 2, 5, 6, 9, 10, 13, 14, 17, 18];
  const Ls = [], as = [], bs = [];
  for (const i of idxs) {
    const p = hand.points[i];
    const x = Math.round(p.x - ox), y = Math.round(p.y - oy);
    if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
    const o = (y * bw + x) * 4;
    const lab = rgbToLab(src[o], src[o + 1], src[o + 2]);
    Ls.push(lab.L); as.push(lab.a); bs.push(lab.b);
  }
  if (!as.length) return null;
  const mid = (arr) => arr.slice().sort((m, n) => m - n)[arr.length >> 1];
  return { L: mid(Ls), a: mid(as), b: mid(bs) };
}

// 在每隻手的 bbox 內逐像素做 CIELab 膚色判定，膚色像素塗白寫進 skinCanvas（攝影機原解析度）。
function buildSkinMask() {
  const W = Math.floor(state.width), H = Math.floor(state.height);
  if (skinCanvas.width !== W || skinCanvas.height !== H) {
    skinCanvas.width = W;
    skinCanvas.height = H;
  }
  skinContext.clearRect(0, 0, W, H);
  const dL = cutoutStyle.skinTolL, dA = cutoutStyle.skinTolA, dB = cutoutStyle.skinTolB;
  for (const hand of state.hands.slice(0, state.maxHands)) {
    // bbox：全部 landmark 的外接框，外擴一圈確保手緣膚色都掃進來。
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const p of hand.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const m = distance(hand.points[5], hand.points[17]) * 0.7;
    minX = Math.max(0, Math.floor(minX - m));
    minY = Math.max(0, Math.floor(minY - m));
    maxX = Math.min(W, Math.ceil(maxX + m));
    maxY = Math.min(H, Math.ceil(maxY + m));
    const bw = maxX - minX, bh = maxY - minY;
    if (bw <= 0 || bh <= 0) continue;
    const src = mirrorContext.getImageData(minX, minY, bw, bh).data;
    const skin = sampleSkin(hand, src, bw, bh, minX, minY);
    if (!skin) continue;
    const out = skinContext.createImageData(bw, bh);
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const so = (y * bw + x) * 4;
        const lab = rgbToLab(src[so], src[so + 1], src[so + 2]);
        if (Math.abs(lab.L - skin.L) <= dL && Math.abs(lab.a - skin.a) <= dA && Math.abs(lab.b - skin.b) <= dB) {
          out.data[so] = 255;
          out.data[so + 1] = 255;
          out.data[so + 2] = 255;
          out.data[so + 3] = 255;
        }
      }
    }
    skinContext.putImageData(out, minX, minY);
  }
}

function buildHandMask() {
  maskContext.setTransform(1, 0, 0, 1, 0, 0);
  maskContext.clearRect(0, 0, state.width, state.height);
  for (const hand of state.hands.slice(0, state.maxHands)) {
    drawHandShape(maskContext, hand);
  }
  // landmark 框圈出手的範圍（排除遠處臉），框內交集 CIELab 膚色遮罩，
  // 在攝影機原解析度修出真實手緣——比低解析 person mask 邊緣更銳、且不把整張臉算前景。
  buildSkinMask();
  maskContext.globalCompositeOperation = "destination-in";
  maskContext.drawImage(skinCanvas, 0, 0);
  maskContext.globalCompositeOperation = "source-over";
}

// 整個人模式：直接把低解析的人像信心遮罩鏡像放大到全畫面，比逐像素手形快。
const personMaskCanvas = document.createElement("canvas");
const personMaskContext = personMaskCanvas.getContext("2d");
// 把低解析的人像信心遮罩轉成 alpha 畫進 personMaskCanvas（尚未鏡像、尚未放大）。
function renderPersonMaskCanvas(mask) {
  personMaskCanvas.width = mask.width;
  personMaskCanvas.height = mask.height;
  const image = personMaskContext.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    const alpha = Math.round(255 * smoothstep((mask.data[i] - cutoutStyle.personLow) /
      (cutoutStyle.personHigh - cutoutStyle.personLow)));
    if (alpha > 0) {
      image.data[i * 4] = 255;
      image.data[i * 4 + 1] = 255;
      image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = alpha;
    }
  }
  personMaskContext.putImageData(image, 0, 0);
}

// 把 personMaskCanvas 鏡像放大畫到 maskContext。compositeOp 決定是直接覆蓋（整個人）或交集（手形框內）。
function blitPersonMask(compositeOp) {
  maskContext.save();
  maskContext.globalCompositeOperation = compositeOp;
  // 遮罩對應未鏡像影像，畫到鏡像畫面上要水平翻轉。
  maskContext.translate(state.width, 0);
  maskContext.scale(-1, 1);
  maskContext.imageSmoothingEnabled = true;
  maskContext.drawImage(personMaskCanvas, 0, 0, state.width, state.height);
  maskContext.restore();
}

function buildPersonMask(mask) {
  maskContext.setTransform(1, 0, 0, 1, 0, 0);
  maskContext.clearRect(0, 0, state.width, state.height);
  if (!mask) {
    return;
  }
  renderPersonMaskCanvas(mask);
  blitPersonMask("source-over");
}

function drawUserCutout(mask) {
  // 膚色分割要讀鏡像像素，鏡像畫面須在建遮罩前就緒。
  drawMirroredVideoTo(mirrorContext);
  if (state.cutoutMode === "person") {
    buildPersonMask(mask);
  } else {
    buildHandMask();
  }
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
      // 低可信軸向沿用上一幀；近乎反向的跳變視為 landmark 誤配，不讓路徑瞬間翻面。
      const dot = track.axis.x * hand.axis.x + track.axis.y * hand.axis.y;
      if (hand.axisConfidence >= 1.15 && dot > -0.35) {
        track.axis = normalizeVector({
          x: lerp(track.axis.x, hand.axis.x, 0.22),
          y: lerp(track.axis.y, hand.axis.y, 0.22)
        }, track.axis);
        track.reverseFrames = 0;
      } else if (hand.axisConfidence >= 1.15) {
        // 連續多幀都反向代表使用者真的轉手；短暫跳點則不會累積到門檻。
        track.reverseFrames += 1;
        if (track.reverseFrames >= 4) {
          track.axis = hand.axis;
          track.reverseFrames = 0;
        }
      } else {
        track.reverseFrames = 0;
      }
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
      axis: hand.axisConfidence >= 1.15 ? hand.axis : { x: 0, y: -1 },
      reverseFrames: 0,
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

function rayToExpandedViewport(origin, direction, margin) {
  const bounds = { left: -margin, right: state.width + margin, top: -margin, bottom: state.height + margin };
  const candidates = [];
  if (direction.x > 0.0001) candidates.push((bounds.right - origin.x) / direction.x);
  if (direction.x < -0.0001) candidates.push((bounds.left - origin.x) / direction.x);
  if (direction.y > 0.0001) candidates.push((bounds.bottom - origin.y) / direction.y);
  if (direction.y < -0.0001) candidates.push((bounds.top - origin.y) / direction.y);
  const t = Math.min(...candidates.filter((value) => value > 0));
  return { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
}

function drawImageHands() {
  for (const track of state.tracked) {
    const tip = track.tip;

    // 方向取自使用者手腕朝食指尖的平滑主軸；圖片手永遠由主軸前方的畫外伸來。
    const scaledWidth = state.width * 0.55 * state.handScale;
    const margin = scaledWidth * 0.08;
    const start = rayToExpandedViewport(tip, track.axis, margin);
    const entry = rayToExpandedViewport(tip, { x: -track.axis.x, y: -track.axis.y }, margin);

    // 伸出量＝指尖沿主軸的伸入深度：身後邊界 entry 到前方邊界 start 之間，指尖所在的相對位置。
    // 往圖片手方向伸手→reach 變大、滿值相觸；反向收回→退開。0.6 為觸發靈敏度旋鈕。
    const toStart = Math.hypot(start.x - tip.x, start.y - tip.y);
    const toEntry = Math.hypot(entry.x - tip.x, entry.y - tip.y);
    const reach = toEntry / (toEntry + toStart || 1);
    const target = track.retracting ? 0 : clamp(reach / 0.6, 0, 1);
    track.t = lerp(track.t, target, 0.25);
    const eased = smoothstep(track.t);

    const anchorX = lerp(start.x, tip.x, eased);
    const anchorY = lerp(start.y, tip.y, eased);

    // 圖片手由畫外朝使用者前進，指向與使用者主軸相反；素材預設朝左，只旋轉、不翻面。
    const imageDirection = { x: -track.axis.x, y: -track.axis.y };
    const theta = Math.atan2(imageDirection.y, imageDirection.x) - Math.PI;

    const asset = handAssets[track.styleIndex];

    context.save();
    context.shadowColor = "rgba(30, 20, 8, 0.4)";
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
    context.translate(anchorX, anchorY);
    context.rotate(theta);
    if (asset && asset.ready) {
      const scale = scaledWidth / asset.img.width;
      context.scale(scale, scale);
      context.drawImage(asset.img, -asset.tip.x * asset.img.width, -asset.tip.y * asset.img.height);
    } else {
      const scale = scaledWidth / 680;
      context.scale(scale, scale);
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
    // 只有「整個人」模式需要人像分割；「只露出手」改用膚色分割，不必跑 segmenter（省一次推論）。
    const needSegmenter = state.cutoutMode === "person";
    // segmenter 尚未就緒時以冷卻時間重試，失敗只記一次 log，避免每幀洗版又能恢復。
    if (needSegmenter && !state.segmenter && now >= segmenterRetryAt) {
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
      if (needSegmenter && state.segmenter) {
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
