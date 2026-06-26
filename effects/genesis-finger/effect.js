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
  // 「整個人」模式用：信心 <personLow 透明、>personHigh 全不透明，中間羽化。
  // 門檻提高、羽化帶收窄＝邊緣更銳、低信心背景（頭髮外緣雜訊）不顯示，去背更乾淨。
  personLow: 0.35,
  personHigh: 0.6,
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
  handScale: 1,
  maxHands: 2,
  capturing: false, // 拍照取景中：主畫面只顯示乾淨鏡像 webcam、暫停圖片手互動
  handSource: "builtin" // 圖片手來源：builtin＝內建五種、custom＝使用者拍的神之手
};

// 使用者拍下的「神之手」去背圖；非 null 時取代全部內建手（只保留最新一隻、不持久化）。
let customHand = null;

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

// 圖片手來源切換：拍過神之手後可隨時切回內建五種（也是「不想用神之手」的退路）。
const handSourceControl = shell.addParam({
  type: "select",
  key: "handSource",
  label: "圖片手來源",
  value: state.handSource,
  options: [
    { value: "builtin", label: "內建五種手" },
    { value: "custom", label: "我的神之手" }
  ],
  onChange(value) { state.handSource = value; }
});

// 頂部按鈕：拍下自己的手 → 去背 → 確認後成為唯一互動的「神之手」。
shell.addButton({ label: "✋ 創造神之手", onClick: () => openHandCapture() });

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
  const pad = palmWidth * 0.45;
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
    ctx.lineWidth = palmWidth * (f === 0 ? 0.46 : 0.42);
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
  const keep = palmWidth * 0.5;
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
function buildSkinMask(hands) {
  const W = Math.floor(state.width), H = Math.floor(state.height);
  if (skinCanvas.width !== W || skinCanvas.height !== H) {
    skinCanvas.width = W;
    skinCanvas.height = H;
  }
  skinContext.clearRect(0, 0, W, H);
  const dL = cutoutStyle.skinTolL, dA = cutoutStyle.skinTolA, dB = cutoutStyle.skinTolB;
  for (const hand of hands) {
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

// 在 targetCtx 畫出指定手的去背遮罩：landmark 手形框 ∩ CIELab 膚色，得到貼合真實手緣的白色遮罩。
// 即時畫面已固定「整個人」不再呼叫，僅供「創造神之手」拍照去背用（傳單手＋離屏 ctx）。
function buildHandMask(hands, targetCtx) {
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, state.width, state.height);
  for (const hand of hands) {
    drawHandShape(targetCtx, hand);
  }
  buildSkinMask(hands);
  targetCtx.globalCompositeOperation = "destination-in";
  targetCtx.drawImage(skinCanvas, 0, 0);
  targetCtx.globalCompositeOperation = "source-over";
}

// 整個人模式：直接把低解析的人像信心遮罩鏡像放大到全畫面，比逐像素手形快。
const personMaskCanvas = document.createElement("canvas");
const personMaskContext = personMaskCanvas.getContext("2d");
// 把低解析的人像信心遮罩轉成 alpha 畫進 personMaskCanvas（尚未鏡像、尚未放大）。
function renderPersonMaskCanvas(mask, low = cutoutStyle.personLow, high = cutoutStyle.personHigh) {
  personMaskCanvas.width = mask.width;
  personMaskCanvas.height = mask.height;
  const image = personMaskContext.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i += 1) {
    const alpha = Math.round(255 * smoothstep((mask.data[i] - low) / (high - low)));
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
  // 即時畫面固定「整個人」去背；手部去背（buildHandMask）只保留給拍照「創造神之手」用。
  // 鏡像離屏由 render 每幀統一更新（拍照取景時也要最新），這裡直接用。
  buildPersonMask(mask);
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
      touchTime: 0,
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

    // 觸碰持續度：指尖逼近相觸（t>0.9）持續累加、離開緩衰；drawTouchGlows 用它讓光暈越久越亮。
    if (track.t > 0.9) track.touchTime = Math.min((track.touchTime || 0) + 1, TOUCH_FULL);
    else track.touchTime = Math.max((track.touchTime || 0) - 4, 0);

    const anchorX = lerp(start.x, tip.x, eased);
    const anchorY = lerp(start.y, tip.y, eased);

    // 圖片手由畫外朝使用者前進，指向與使用者主軸相反；素材預設朝左，只旋轉、不翻面。
    const imageDirection = { x: -track.axis.x, y: -track.axis.y };
    const theta = Math.atan2(imageDirection.y, imageDirection.x) - Math.PI;

    // 來源為 custom 且已拍過神之手 → 全部改用它；否則用該 track 隨機分到的內建風格。
    const useCustom = state.handSource === "custom" && customHand && customHand.ready;
    const asset = useCustom ? customHand : handAssets[track.styleIndex];

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

// 觸碰持續到「全亮」所需幀數（約 1.25 秒 @60fps）。
const TOUCH_FULL = 75;

// 指尖相觸的火光，呼應《創世紀》觸碰瞬間；越久越亮越大。畫在真手 cutout 之後才不會被剪影蓋掉。
function drawTouchGlows() {
  context.save();
  context.globalCompositeOperation = "lighter"; // 疊加混色＝更亮、像迸發的火光
  for (const track of state.tracked) {
    const hold = track.touchTime || 0;
    if (hold <= 0) {
      continue;
    }
    const p = Math.min(hold / TOUCH_FULL, 1); // 持續度 0~1：越久越接近 1
    // 沿手主軸往指尖前方推，讓光暈落在兩指尖交會處，而非貼在使用者手指上。
    const off = (30 + 0 * p) * state.handScale;
    const tip = { x: track.tip.x + track.axis.x * off, y: track.tip.y + track.axis.y * off };
    const radius = (58 + 92 * p) * state.handScale; // 外暈半徑隨持續變大
    const core = 0.5 + 0.5 * p;                      // 整體亮度隨持續提高
    // 外層暖色柔光
    const glow = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius);
    glow.addColorStop(0, `rgba(255, 236, 196, ${0.85 * core})`);
    glow.addColorStop(0.4, `rgba(255, 214, 150, ${0.4 * core})`);
    glow.addColorStop(1, "rgba(255, 210, 140, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
    context.fill();
    // 內核白熱亮點
    const coreR = (12 + 20 * p) * state.handScale;
    const cg = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, coreR);
    cg.addColorStop(0, `rgba(255, 255, 246, ${0.95 * core})`);
    cg.addColorStop(1, "rgba(255, 255, 246, 0)");
    context.fillStyle = cg;
    context.beginPath();
    context.arc(tip.x, tip.y, coreR, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
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

// ---- 創造神之手：拍下使用者的手、去背、方位正規化成「食指朝左、手臂朝右」的圖片手素材 ----
// 回傳去背後（透明背景、已裁切）的 PNG dataURL；偵測不到有效手回傳 null。
function captureHand(hand) {
  const W = Math.floor(state.width), H = Math.floor(state.height);
  if (W < 2 || H < 2) return null;

  // 1. 遮罩 = 人像分割（去背景、邊緣準、不受牆色干擾）∩ landmark 手形框（排除臉與手臂）。
  //    比純膚色判定可靠：淺暖色牆不會再被當成手保留。無 person mask 時才退回手形∩膚色。
  const maskC = document.createElement("canvas");
  maskC.width = W; maskC.height = H;
  const mctx = maskC.getContext("2d");
  if (state.personMask) {
    // 拍照用寬鬆門檻（手完整優先），不沿用即時那組偏嚴的值，避免手邊緣被切掉。
    renderPersonMaskCanvas(state.personMask, 0.1, 0.35);
    mctx.save();
    mctx.translate(W, 0);   // person mask 對應未鏡像影像，畫到鏡像座標要水平翻轉
    mctx.scale(-1, 1);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(personMaskCanvas, 0, 0, W, H);
    mctx.restore();
    const roi = document.createElement("canvas");
    roi.width = W; roi.height = H;
    drawHandShape(roi.getContext("2d"), hand); // 手形框只當 ROI，真實邊緣交給 person mask
    mctx.globalCompositeOperation = "destination-in";
    mctx.drawImage(roi, 0, 0);
    mctx.globalCompositeOperation = "source-over";
  } else {
    buildHandMask([hand], mctx);
  }

  // 2. 去背：鏡像畫面 ∩ 手遮罩
  const cutC = document.createElement("canvas");
  cutC.width = W; cutC.height = H;
  const cut = cutC.getContext("2d");
  cut.drawImage(mirrorCanvas, 0, 0);
  cut.globalCompositeOperation = "destination-in";
  cut.drawImage(maskC, 0, 0);

  // 3. 取去背手的未旋轉外接框：用它決定旋轉畫布大小，避免旋轉時手轉出原畫面邊界被裁掉。
  let cd;
  try {
    cd = cut.getImageData(0, 0, W, H).data;
  } catch (error) {
    console.warn("captureHand 取像失敗（canvas 可能被污染）", error);
    return null;
  }
  let hnx = W, hny = H, hxx = -1, hxy = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (cd[(y * W + x) * 4 + 3] > 24) {
        if (x < hnx) hnx = x;
        if (y < hny) hny = y;
        if (x > hxx) hxx = x;
        if (y > hxy) hxy = y;
      }
    }
  }
  if (hxx < hnx) return null; // 全透明＝沒切到手
  const handCx = (hnx + hxx) / 2, handCy = (hny + hxy) / 2;

  // 4. 方位正規化：在「容得下任意角度旋轉」的方形畫布（邊長＝手對角線）上，手置中、食指軸轉到朝左。
  const a = hand.axis;
  const rot = Math.PI - Math.atan2(a.y, a.x);
  const side = Math.ceil(Math.hypot(hxx - hnx + 1, hxy - hny + 1)) + 8;
  const place = (ctx, src) => {
    ctx.translate(side / 2, side / 2);
    ctx.rotate(rot);
    ctx.translate(-handCx, -handCy);
    ctx.drawImage(src, 0, 0);
  };
  const rotC = document.createElement("canvas");
  rotC.width = side; rotC.height = side;
  const rc = rotC.getContext("2d");
  place(rc, cutC);
  // 同框、同旋轉的「原始未去背」畫面，供筆刷「補回」誤刪的部分取像素
  const rawRot = document.createElement("canvas");
  rawRot.width = side; rawRot.height = side;
  place(rawRot.getContext("2d"), mirrorCanvas);

  // 5. 掃旋轉後外接框，外加邊距裁切，輸出
  const rd = rc.getImageData(0, 0, side, side).data;
  let minX = side, minY = side, maxX = -1, maxY = -1;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (rd[(y * side + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  const pad = 10;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(side - 1, maxX + pad); maxY = Math.min(side - 1, maxY + pad);
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const cutOut = document.createElement("canvas");
  cutOut.width = bw; cutOut.height = bh;
  cutOut.getContext("2d").drawImage(rotC, minX, minY, bw, bh, 0, 0, bw, bh);
  const rawOut = document.createElement("canvas");
  rawOut.width = bw; rawOut.height = bh;
  rawOut.getContext("2d").drawImage(rawRot, minX, minY, bw, bh, 0, 0, bw, bh);
  return { cut: cutOut, raw: rawOut, width: bw, height: bh };
}

// 拍照 overlay：兩階段（拍下 → 預覽＋筆刷修補確認）；取景時主畫面顯示乾淨 webcam。
let captureOverlay = null;

function openHandCapture() {
  if (captureOverlay) return;
  state.capturing = true; // 主畫面切成乾淨鏡像 webcam、暫停互動
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "60", display: "flex",
    flexDirection: "column", alignItems: "center", justifyContent: "space-between",
    pointerEvents: "none"
  });

  const hint = document.createElement("div");
  Object.assign(hint.style, {
    marginTop: "24px", padding: "10px 18px", borderRadius: "20px",
    background: "rgba(40,28,12,0.72)", color: "#fff6e2",
    font: "600 16px 'Noto Sans TC','Microsoft JhengHei',sans-serif",
    textAlign: "center", maxWidth: "80%"
  });

  // 預覽＋筆刷編輯：擦掉沒去乾淨處／補回被誤刪處
  const previewWrap = document.createElement("div");
  Object.assign(previewWrap.style, {
    display: "none", flexDirection: "column", alignItems: "center", gap: "10px",
    padding: "12px", borderRadius: "16px", background: "rgba(30,20,10,0.9)",
    pointerEvents: "auto"
  });
  const editCanvas = document.createElement("canvas");
  Object.assign(editCanvas.style, {
    maxWidth: "60vw", maxHeight: "42vh", display: "block",
    cursor: "none", touchAction: "none", // 用自訂圓圈游標取代系統十字
    // 棋盤底襯托透明處，方便看清要修補的邊緣
    background: "repeating-conic-gradient(#5a4636 0% 25%, #6f5947 0% 50%) 50% / 20px 20px"
  });
  const ectx = editCanvas.getContext("2d");

  let brushMode = "erase";
  let brushSize = 22;

  // 跟隨指標的圓圈游標：直徑＝筆刷大小，讓使用者一眼看出筆畫範圍
  const cursorEl = document.createElement("div");
  Object.assign(cursorEl.style, {
    position: "fixed", borderRadius: "50%", pointerEvents: "none",
    border: "2px solid rgba(255,255,255,0.92)", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
    transform: "translate(-50%,-50%)", display: "none", zIndex: "61"
  });
  let lastClientX = 0, lastClientY = 0;
  function updateCursor(clientX, clientY) {
    lastClientX = clientX; lastClientY = clientY;
    const r = editCanvas.getBoundingClientRect();
    const d = brushSize * 2 * (r.width / (editCanvas.width || 1)); // 筆刷半徑（canvas px）換算到顯示尺寸
    cursorEl.style.width = d + "px";
    cursorEl.style.height = d + "px";
    cursorEl.style.left = clientX + "px";
    cursorEl.style.top = clientY + "px";
    cursorEl.style.display = "block";
  }

  // 工具列：擦除/補回 分段切換 ＋ 筆畫大小 ＋ 重置
  const tools = document.createElement("div");
  Object.assign(tools.style, {
    display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
    justifyContent: "center", color: "#fff6e2",
    font: "600 14px 'Noto Sans TC','Microsoft JhengHei',sans-serif"
  });

  // 分段切換（segmented control）：左「擦除」右「補回」，當前高亮
  const seg = document.createElement("div");
  Object.assign(seg.style, {
    display: "inline-flex", borderRadius: "18px", overflow: "hidden",
    border: "1px solid rgba(255,246,226,0.35)"
  });
  const eraseSeg = document.createElement("button");
  const restoreSeg = document.createElement("button");
  eraseSeg.type = restoreSeg.type = "button";
  eraseSeg.textContent = "🧽 擦除";
  restoreSeg.textContent = "🖌 補回";
  for (const b of [eraseSeg, restoreSeg]) {
    Object.assign(b.style, {
      padding: "8px 16px", border: "none", cursor: "pointer",
      font: "700 14px 'Noto Sans TC','Microsoft JhengHei',sans-serif",
      background: "transparent", color: "#fff6e2"
    });
  }
  function refreshSeg() {
    eraseSeg.style.background = brushMode === "erase" ? "#caa46f" : "transparent";
    eraseSeg.style.color = brushMode === "erase" ? "#2a1c0c" : "#fff6e2";
    restoreSeg.style.background = brushMode === "restore" ? "#caa46f" : "transparent";
    restoreSeg.style.color = brushMode === "restore" ? "#2a1c0c" : "#fff6e2";
  }
  refreshSeg();
  eraseSeg.addEventListener("click", () => { brushMode = "erase"; refreshSeg(); });
  restoreSeg.addEventListener("click", () => { brushMode = "restore"; refreshSeg(); });
  seg.append(eraseSeg, restoreSeg);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button"; resetBtn.textContent = "重置";
  Object.assign(resetBtn.style, {
    padding: "8px 14px", borderRadius: "18px", border: "none", cursor: "pointer",
    font: "700 14px 'Noto Sans TC','Microsoft JhengHei',sans-serif",
    background: "rgba(255,246,226,0.16)", color: "#fff6e2"
  });

  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = "筆畫";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range"; sizeInput.min = "6"; sizeInput.max = "80"; sizeInput.step = "2";
  sizeInput.value = String(brushSize);
  sizeInput.addEventListener("input", () => {
    brushSize = Number(sizeInput.value);
    if (cursorEl.style.display === "block") updateCursor(lastClientX, lastClientY); // 即時反映新粗細
  });
  tools.append(seg, sizeLabel, sizeInput, resetBtn);
  previewWrap.append(editCanvas, tools);

  const bar = document.createElement("div");
  Object.assign(bar.style, {
    marginBottom: "28px", display: "flex", gap: "14px", pointerEvents: "auto"
  });
  const mkBtn = (text, primary) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    Object.assign(b.style, {
      padding: "12px 22px", borderRadius: "24px", border: "none", cursor: "pointer",
      font: "700 16px 'Noto Sans TC','Microsoft JhengHei',sans-serif",
      background: primary ? "#caa46f" : "rgba(40,28,12,0.72)",
      color: primary ? "#2a1c0c" : "#fff6e2"
    });
    return b;
  };
  const shoot = mkBtn("📸 拍下", true);
  const cancel = mkBtn("取消", false);
  const accept = mkBtn("✓ 用這隻", true);
  const retake = mkBtn("重拍", false);

  // 筆刷：currentShot.cut＝去背圖、currentShot.raw＝同框原始畫面（補回用）
  let currentShot = null;
  function paintDot(x, y) {
    if (brushMode === "erase") {
      ectx.save();
      ectx.globalCompositeOperation = "destination-out";
      ectx.beginPath(); ectx.arc(x, y, brushSize, 0, Math.PI * 2); ectx.fill();
      ectx.restore();
    } else {
      ectx.save();
      ectx.beginPath(); ectx.arc(x, y, brushSize, 0, Math.PI * 2); ectx.clip();
      ectx.drawImage(currentShot.raw, 0, 0);
      ectx.restore();
    }
  }
  function canvasXY(e) {
    const r = editCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (editCanvas.width / r.width),
      y: (e.clientY - r.top) * (editCanvas.height / r.height)
    };
  }
  let painting = false, lastX = 0, lastY = 0;
  function stampTo(x, y) {
    // 沿移動路徑補插中間點，避免快速拖曳出現斷點
    const dx = x - lastX, dy = y - lastY;
    const steps = Math.max(1, Math.floor(Math.hypot(dx, dy) / Math.max(2, brushSize / 2)));
    for (let i = 1; i <= steps; i += 1) {
      paintDot(lastX + (dx * i) / steps, lastY + (dy * i) / steps);
    }
    lastX = x; lastY = y;
  }
  editCanvas.addEventListener("pointerdown", (e) => {
    if (!currentShot) return;
    painting = true;
    const p = canvasXY(e); lastX = p.x; lastY = p.y;
    paintDot(p.x, p.y);
    updateCursor(e.clientX, e.clientY);
    editCanvas.setPointerCapture(e.pointerId);
  });
  editCanvas.addEventListener("pointermove", (e) => {
    updateCursor(e.clientX, e.clientY); // 不論是否塗抹都更新圓圈位置
    if (!painting) return;
    const p = canvasXY(e); stampTo(p.x, p.y);
  });
  editCanvas.addEventListener("pointerenter", (e) => updateCursor(e.clientX, e.clientY));
  editCanvas.addEventListener("pointerleave", () => { cursorEl.style.display = "none"; });
  const endPaint = () => { painting = false; };
  editCanvas.addEventListener("pointerup", endPaint);
  editCanvas.addEventListener("pointercancel", endPaint);

  function close() {
    overlay.remove();
    captureOverlay = null;
    state.capturing = false; // 恢復圖片手互動
  }
  function toShoot() {
    currentShot = null;
    previewWrap.style.display = "none";
    hint.textContent = "把手伸進畫面中央，手指張開，按「拍下」";
    shoot.style.display = ""; cancel.style.display = "";
    accept.style.display = "none"; retake.style.display = "none";
  }

  shoot.addEventListener("click", () => {
    const hand = state.hands[0];
    if (!hand) { hint.textContent = "沒偵測到手，把手伸進畫面再按拍下"; return; }
    const shot = captureHand(hand);
    if (!shot) { hint.textContent = "去背沒成功，調整光線或手的位置再試"; return; }
    currentShot = shot;
    editCanvas.width = shot.width;
    editCanvas.height = shot.height;
    ectx.clearRect(0, 0, shot.width, shot.height);
    ectx.drawImage(shot.cut, 0, 0);
    previewWrap.style.display = "flex";
    hint.textContent = "🧽擦掉殘留、🖌補回缺角；滿意按「用這隻」，反悔按「取消」回原本";
    shoot.style.display = "none";
    cancel.style.display = ""; // 預覽階段保留「取消」當反悔退路
    accept.style.display = ""; retake.style.display = "";
  });
  resetBtn.addEventListener("click", () => {
    if (!currentShot) return;
    ectx.clearRect(0, 0, editCanvas.width, editCanvas.height);
    ectx.drawImage(currentShot.cut, 0, 0);
  });
  cancel.addEventListener("click", close);
  retake.addEventListener("click", toShoot);
  accept.addEventListener("click", () => {
    if (!currentShot) return;
    const img = new Image();
    img.onload = () => {
      customHand = { img, ready: true, tip: detectTip(img) };
      state.handSource = "custom";          // 拍好就自動啟用神之手
      if (handSourceControl) handSourceControl.value = "custom"; // 同步面板選單顯示
      close();
    };
    img.onerror = close;
    img.src = editCanvas.toDataURL("image/png"); // 含使用者筆刷修補後的結果
  });

  bar.append(shoot, cancel, accept, retake);
  overlay.append(hint, previewWrap, bar, cursorEl);
  shell.container.append(overlay);
  captureOverlay = overlay;
  toShoot();
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
    // 固定「整個人」去背，人像分割每幀都要跑。segmenter 尚未就緒時以冷卻時間重試，失敗只記一次 log。
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

    drawMirroredVideoTo(mirrorContext); // 每幀更新鏡像離屏（即時去背與拍照取景共用）
    context.clearRect(0, 0, state.width, state.height);
    if (state.capturing) {
      // 拍照取景：主畫面只顯示乾淨鏡像 webcam、暫停圖片手互動，讓使用者專心擺手不被混淆
      context.drawImage(mirrorCanvas, 0, 0);
    } else {
      updateTracked();
      drawBackground();
      drawUserCutout(mask);   // 先畫使用者人像
      drawImageHands();       // 神之手畫在使用者前面（需求：圖片手不被人頭擋住）
      drawTouchGlows();       // 觸碰微光畫在最上層，相觸瞬間才看得到火光
      if (state.hands.length === 0) {
        drawPrompt();
      }
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
