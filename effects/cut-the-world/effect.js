import { FilesetResolver, HandLandmarker } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "cut-the-world" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");
const baseCanvas = document.createElement("canvas");
const baseContext = baseCanvas.getContext("2d");
const effectCanvas = document.createElement("canvas");
const effectContext = effectCanvas.getContext("2d", { willReadFrequently: true });
const sampleCanvas = document.createElement("canvas");
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
// 洞的內陰影快取層：只在洞增減或 resize 時重畫，避免每幀付 blur 成本
const shadowCanvas = document.createElement("canvas");
const shadowContext = shadowCanvas.getContext("2d");

const state = {
  width: 1,
  height: 1,
  mode: "tech-pixel",
  fallSpeed: 1,
  grain: 12,
  rim: 16,
  armed: false,
  holdStart: 0,
  fingertip: null,
  path: [],
  pathFadeStart: 0,
  lastGestureTime: 0,
  holes: [],
  glows: [],
  fragments: [],
  lastVideoTime: -1,
  hand: null,
  hasVideoFrame: false,
  animationId: 0,
  previousFrameTime: 0,
  matrixChars: [],
  matrixColumns: [],
  lastEffectTime: 0,
  lumLow: 0,
  lumHigh: 1,
  prevLums: null,
  physicsAccum: 0
};

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const matrixAlphabet = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789@#$%&*";

// 碎片剛體物理交給 Matter.js：依形狀翻倒、彈跳、堆疊，支撐消失自動掉落
const { Engine: MatterEngine, Bodies, Body: MatterBody, Composite, Vertices } = window.Matter;
const engine = MatterEngine.create();
let floorBody = null;

// 洞緣畫法模仿在牆上打洞：上緣露出一條牆體斷面（厚度帶），斷面下方再落陰影
function rebuildHoleShadows() {
  shadowCanvas.width = Math.max(1, canvas.width);
  shadowCanvas.height = Math.max(1, canvas.height);
  const rim = state.rim;
  for (const hole of state.holes) {
    shadowContext.save();
    pathOn(shadowContext, hole);
    shadowContext.clip();

    // 1. 牆體斷面：整洞填水泥色，再把同形狀往下位移 rim 擦掉，留下上緣月牙厚度帶
    //    （save/restore 只保護 translate，GCO 需手動歸回 source-over）
    pathOn(shadowContext, hole);
    shadowContext.fillStyle = "#9e978b";
    shadowContext.fill();
    shadowContext.globalCompositeOperation = "destination-out";
    shadowContext.save();
    shadowContext.translate(0, rim);
    pathOn(shadowContext, hole);
    shadowContext.fill();
    shadowContext.restore();
    // 斷面下半疊暗色，做出立面轉折
    shadowContext.globalCompositeOperation = "source-atop";
    shadowContext.save();
    shadowContext.translate(0, rim * 0.45);
    pathOn(shadowContext, hole);
    shadowContext.fillStyle = "rgba(56,50,44,0.35)";
    shadowContext.fill();
    shadowContext.restore();
    shadowContext.globalCompositeOperation = "source-over";

    // 2. 四周內陰影（畫在斷面之後才不會被填色蓋掉，側邊與底部因此有深度）
    pathOn(shadowContext, hole);
    shadowContext.strokeStyle = "rgba(0,0,0,0.8)";
    shadowContext.lineWidth = 3;
    shadowContext.shadowColor = "rgba(0,0,0,0.9)";
    shadowContext.shadowBlur = 22;
    shadowContext.stroke();
    shadowContext.shadowBlur = 0;

    // 3. 斷面下方的洞內陰影（位移超過厚度帶，暈在斷面底下）
    pathOn(shadowContext, hole);
    shadowContext.strokeStyle = "rgba(0,0,0,0.45)";
    shadowContext.lineWidth = 3;
    shadowContext.shadowColor = "rgba(0,0,0,0.85)";
    shadowContext.shadowBlur = 34;
    shadowContext.shadowOffsetY = rim + 10;
    shadowContext.stroke();
    shadowContext.shadowBlur = 0;
    shadowContext.shadowOffsetY = 0;

    // 4. 斷面與洞內的硬邊交界線＋洞口外緣受光亮線
    shadowContext.save();
    shadowContext.translate(0, rim);
    pathOn(shadowContext, hole);
    shadowContext.strokeStyle = "rgba(30,26,22,0.85)";
    shadowContext.lineWidth = 2;
    shadowContext.stroke();
    shadowContext.restore();
    pathOn(shadowContext, hole);
    shadowContext.strokeStyle = "rgba(255,255,255,0.3)";
    shadowContext.lineWidth = 1.5;
    shadowContext.stroke();

    shadowContext.restore();
  }
}

function updateFloor() {
  if (floorBody) Composite.remove(engine.world, floorBody);
  // 地板頂面貼齊畫布底緣，碎片以實際多邊形頂點接觸，不會浮空
  floorBody = Bodies.rectangle(state.width / 2, state.height + 60, state.width * 4, 120, { isStatic: true });
  Composite.add(engine.world, floorBody);
}

canvas.style.position = "absolute";
canvas.style.inset = "0";
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";
video.muted = true;
video.playsInline = true;
video.style.display = "none";
shell.container.style.overflow = "hidden";
shell.container.style.background = "#05070a";
shell.container.append(video, canvas);

shell.addParam({
  type: "select",
  key: "mode",
  label: "洞內特效",
  value: state.mode,
  options: [
    { value: "tech-pixel", label: "科技像素" },
    { value: "matrix", label: "動態亂碼" },
    { value: "halftone", label: "印刷拼貼" },
    { value: "woodcut", label: "色塊版畫" }
  ],
  onChange(value) {
    state.mode = value;
    state.prevLums = null; // 避免切回動態亂碼時拿舊幀比較，整片誤判成移動閃白
  }
});

shell.addParam({
  type: "range",
  key: "grain",
  label: "特效顆粒",
  min: 8,
  max: 32,
  step: 1,
  value: state.grain,
  onChange(value) {
    state.grain = Number(value);
  }
});

shell.addParam({
  type: "range",
  key: "rim",
  label: "洞緣厚度",
  min: 6,
  max: 36,
  step: 1,
  value: state.rim,
  onChange(value) {
    state.rim = Number(value);
    rebuildHoleShadows();
  }
});

shell.addParam({
  type: "range",
  key: "fallSpeed",
  label: "掉落速度",
  min: 0.5,
  max: 3,
  step: 0.1,
  value: state.fallSpeed,
  onChange(value) {
    state.fallSpeed = Number(value);
    engine.gravity.y = state.fallSpeed;
  }
});

shell.addButton({
  label: "重置世界",
  onClick() {
    for (const fragment of state.fragments) Composite.remove(engine.world, fragment.body);
    state.holes = [];
    state.glows = [];
    state.fragments = [];
    state.path = [];
    state.pathFadeStart = 0;
    state.armed = false;
    state.holdStart = 0;
    rebuildHoleShadows();
  }
});

function scalePoint(point, sx, sy) {
  point.x *= sx;
  point.y *= sy;
}

function resize() {
  const oldWidth = state.width;
  const oldHeight = state.height;
  const width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  const height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  const sx = width / oldWidth;
  const sy = height / oldHeight;
  if (oldWidth > 1 || oldHeight > 1) {
    for (const point of state.path) scalePoint(point, sx, sy);
    for (const hole of state.holes) for (const point of hole) scalePoint(point, sx, sy);
    for (const glow of state.glows) for (const point of glow.points) scalePoint(point, sx, sy);
    // ponytail: 非等比縮放時剛體與貼圖用平均比例近似，碎片只活幾秒，誤差可接受
    const s = (sx + sy) / 2;
    for (const fragment of state.fragments) {
      MatterBody.setPosition(fragment.body, {
        x: fragment.body.position.x * sx,
        y: fragment.body.position.y * sy
      });
      MatterBody.scale(fragment.body, s, s);
      fragment.scale *= s;
    }
  }
  state.width = width;
  state.height = height;
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
  baseCanvas.width = canvas.width;
  baseCanvas.height = canvas.height;
  updateFloor();
  rebuildHoleShadows();
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mirrorPoint(point) {
  return { x: (1 - point.x) * state.width, y: point.y * state.height };
}

function isDrawingGesture(landmarks) {
  const wrist = landmarks[0];
  return distance(landmarks[8], wrist) > distance(landmarks[6], wrist)
    && distance(landmarks[12], wrist) < distance(landmarks[10], wrist)
    && distance(landmarks[16], wrist) < distance(landmarks[14], wrist);
}

function segmentIntersection(a, b, c, d) {
  const rX = b.x - a.x;
  const rY = b.y - a.y;
  const sX = d.x - c.x;
  const sY = d.y - c.y;
  const denominator = rX * sY - rY * sX;
  if (Math.abs(denominator) < 0.00001) return null;
  const qX = c.x - a.x;
  const qY = c.y - a.y;
  const t = (qX * sY - qY * sX) / denominator;
  const u = (qX * rY - qY * rX) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * rX, y: a.y + t * rY };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    sum += points[i].x * next.y - next.x * points[i].y;
  }
  return Math.abs(sum) * 0.5;
}

function findClosedPolygon() {
  const count = state.path.length;
  if (count < 3) return null;
  const a = state.path[count - 2];
  const b = state.path[count - 1];
  // 跳過最近八段，避免手部追蹤抖動形成極小交點。
  for (let i = 0; i <= count - 11; i += 1) {
    const intersection = segmentIntersection(a, b, state.path[i], state.path[i + 1]);
    if (intersection) return [intersection, ...state.path.slice(i + 1)];
  }
  if (count >= 30 && distance(b, state.path[0]) < 30) {
    return [...state.path];
  }
  return null;
}

function appendPathPoint(point, now) {
  const previous = state.path[state.path.length - 1];
  if (previous && distance(previous, point) < 4) return;
  state.path.push(point);
  const polygon = findClosedPolygon();
  if (!polygon || polygonArea(polygon) < state.width * state.height * 0.01) return;
  state.glows.push({ points: polygon, start: now });
  state.path = [];
  state.pathFadeStart = 0;
}

function updateHand(landmarks, now) {
  const drawing = landmarks && isDrawingGesture(landmarks);
  if (drawing) {
    state.fingertip = mirrorPoint(landmarks[8]);
    state.lastGestureTime = now;
    // 手勢須維持 0.5 秒才開始畫線，避免手指一入鏡就誤觸
    if (!state.armed) {
      if (!state.holdStart) state.holdStart = now;
      if (now - state.holdStart < 500) return;
      state.armed = true;
    }
    if (state.pathFadeStart) {
      state.path = [];
      state.pathFadeStart = 0;
    }
    appendPathPoint(state.fingertip, now);
    return;
  }
  state.fingertip = null;
  // 確認期允許 200ms 偵測抖動，超過就重新計時
  if (!state.armed && state.holdStart && now - state.lastGestureTime > 200) {
    state.holdStart = 0;
  }
  if (state.armed && now - state.lastGestureTime > 500) {
    state.armed = false;
    state.holdStart = 0;
    if (state.path.length && !state.pathFadeStart) {
      state.pathFadeStart = now;
    }
  }
  if (state.pathFadeStart && now - state.pathFadeStart >= 300) {
    state.path = [];
    state.pathFadeStart = 0;
  }
}

function pathOn(contextToUse, points) {
  contextToUse.beginPath();
  contextToUse.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) contextToUse.lineTo(points[i].x, points[i].y);
  contextToUse.closePath();
}

function drawMirroredVideo(targetContext, width, height) {
  targetContext.save();
  targetContext.clearRect(0, 0, width, height);
  targetContext.translate(width, 0);
  targetContext.scale(-1, 1);
  targetContext.drawImage(video, 0, 0, width, height);
  targetContext.restore();
}

function prepareSample(cellSize) {
  // 特效畫布解析度太低會被拉伸放大，顆粒看起來比 cellSize 大很多；長邊上限 1280 兼顧效能
  let width = Math.max(1, Math.min(1280, Math.round(state.width)));
  let height = Math.max(1, Math.round(width * state.height / state.width));
  if (height > 1280) {
    height = 1280;
    width = Math.max(1, Math.round(height * state.width / state.height));
  }
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  // 重設 canvas 尺寸會清空並重配記憶體，只在尺寸真的變動時做
  if (sampleCanvas.width !== cols || sampleCanvas.height !== rows) {
    sampleCanvas.width = cols;
    sampleCanvas.height = rows;
  }
  drawMirroredVideo(sampleContext, cols, rows);
  if (effectCanvas.width !== width || effectCanvas.height !== height) {
    effectCanvas.width = width;
    effectCanvas.height = height;
  }
  return { width, height, cols, rows };
}

// 自動對比：把當幀亮度範圍拉伸到 0..1，低通平滑避免對比隨畫面跳動
function normalizedLuminance(pixels, count) {
  const lums = new Float32Array(count);
  let low = 1;
  let high = 0;
  for (let i = 0; i < count; i += 1) {
    const p = i * 4;
    const l = (pixels[p] * 0.21 + pixels[p + 1] * 0.72 + pixels[p + 2] * 0.07) / 255;
    lums[i] = l;
    if (l < low) low = l;
    if (l > high) high = l;
  }
  state.lumLow += (low - state.lumLow) * 0.15;
  state.lumHigh += (high - state.lumHigh) * 0.15;
  const range = Math.max(0.08, state.lumHigh - state.lumLow);
  for (let i = 0; i < count; i += 1) {
    lums[i] = Math.min(1, Math.max(0, (lums[i] - state.lumLow) / range));
  }
  return lums;
}

function renderTechPixel() {
  const grid = state.grain;
  const size = prepareSample(grid);
  const image = sampleContext.getImageData(0, 0, size.cols, size.rows);
  // 借 normalizedLuminance 更新平滑後的亮度 min/max，RGB 依同一範圍拉伸後量化，
  // 低對比或偏暗畫面也能用滿亮度階；再壓紅抬藍做冷色科技感
  normalizedLuminance(image.data, size.cols * size.rows);
  const low = state.lumLow * 255;
  const range = Math.max(0.08, state.lumHigh - state.lumLow);
  for (let i = 0; i < image.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const v = (image.data[i + c] - low) / range;
      image.data[i + c] = Math.round(Math.min(255, Math.max(0, v)) / 85) * 85;
    }
    image.data[i] = Math.round(image.data[i] * 0.82);
    image.data[i + 2] = Math.min(255, image.data[i + 2] + 26);
  }
  sampleContext.putImageData(image, 0, 0);
  effectContext.imageSmoothingEnabled = false;
  effectContext.drawImage(sampleCanvas, 0, 0, size.width, size.height);
  effectContext.strokeStyle = "rgba(90, 235, 255, 0.18)";
  effectContext.lineWidth = 1;
  for (let x = 0; x < size.width; x += grid) effectContext.strokeRect(x, 0, 0.5, size.height);
  effectContext.fillStyle = "rgba(0, 0, 0, 0.08)";
  for (let y = 0; y < size.height; y += 3) effectContext.fillRect(0, y, size.width, 1);
}

function renderMatrix(now) {
  const cell = state.grain;
  const size = prepareSample(cell);
  const pixels = sampleContext.getImageData(0, 0, size.cols, size.rows).data;
  const total = size.cols * size.rows;
  if (state.matrixChars.length !== total) {
    state.matrixChars = Array.from({ length: total }, () => Math.floor(Math.random() * matrixAlphabet.length));
    state.matrixColumns = Array.from({ length: size.cols }, (_, column) => (column * 7) % size.rows);
    state.prevLums = null;
  }
  const lums = normalizedLuminance(pixels, total);
  const prev = state.prevLums && state.prevLums.length === total ? state.prevLums : null;
  effectContext.fillStyle = "#020604";
  effectContext.fillRect(0, 0, size.width, size.height);
  effectContext.font = `700 ${cell}px monospace`;
  effectContext.textAlign = "center";
  effectContext.textBaseline = "middle";
  for (let y = 0; y < size.rows; y += 1) {
    for (let x = 0; x < size.cols; x += 1) {
      const index = y * size.cols + x;
      if (Math.random() < 0.05) state.matrixChars[index] = Math.floor(Math.random() * matrixAlphabet.length);
      const t = lums[index];
      const moved = prev ? Math.abs(t - prev[index]) > 0.22 : false;
      const head = Math.floor(state.matrixColumns[x] + now * 0.004) % size.rows === y;
      // 暗處留黑、亮部分層、移動的格子閃白，人形輪廓與動作才看得出來
      if (!head && !moved && t < 0.1) continue;
      if (moved) effectContext.fillStyle = "rgba(245,255,250,0.95)";
      else if (head) effectContext.fillStyle = "rgba(235,255,242,0.9)";
      else if (t > 0.72) effectContext.fillStyle = "rgba(190,255,214,0.95)";
      else effectContext.fillStyle = `rgba(0,255,102,${0.25 + t * 0.75})`;
      effectContext.fillText(matrixAlphabet[state.matrixChars[index]], x * cell + cell / 2, y * cell + cell / 2);
    }
  }
  state.prevLums = lums;
}

function renderHalftone() {
  const cell = state.grain;
  const size = prepareSample(cell);
  const pixels = sampleContext.getImageData(0, 0, size.cols, size.rows).data;
  const lums = normalizedLuminance(pixels, size.cols * size.rows);
  effectContext.fillStyle = "#f2ead8";
  effectContext.fillRect(0, 0, size.width, size.height);
  for (let y = 0; y < size.rows; y += 1) {
    for (let x = 0; x < size.cols; x += 1) {
      const darkness = 1 - lums[y * size.cols + x];
      // gamma 讓中間調不會整片灰，亮處直接留白
      const radius = Math.pow(darkness, 1.35) * cell * 0.72;
      if (radius < 0.5) continue;
      effectContext.fillStyle = "rgba(211,51,68,0.55)";
      effectContext.beginPath();
      effectContext.arc(x * cell + cell / 2 + 2, y * cell + cell / 2 + 2, radius * 0.8, 0, Math.PI * 2);
      effectContext.fill();
      effectContext.fillStyle = "#171513";
      effectContext.beginPath();
      effectContext.arc(x * cell + cell / 2, y * cell + cell / 2, radius, 0, Math.PI * 2);
      effectContext.fill();
    }
  }
}

function renderWoodcut() {
  // 一格＝一個色塊，顆粒參數同樣生效；亮度自動對比後分四個色帶
  const size = prepareSample(state.grain);
  const image = sampleContext.getImageData(0, 0, size.cols, size.rows);
  const lums = normalizedLuminance(image.data, size.cols * size.rows);
  const palette = [[26, 22, 20], [200, 69, 44], [232, 217, 184], [245, 239, 224]];
  for (let i = 0; i < lums.length; i += 1) {
    const color = palette[Math.min(3, Math.floor(lums[i] * 4))];
    const p = i * 4;
    image.data[p] = color[0];
    image.data[p + 1] = color[1];
    image.data[p + 2] = color[2];
  }
  sampleContext.putImageData(image, 0, 0);
  effectContext.imageSmoothingEnabled = false;
  effectContext.drawImage(sampleCanvas, 0, 0, size.width, size.height);
}

function renderEffect(now) {
  if (state.mode === "matrix") renderMatrix(now);
  else if (state.mode === "halftone") renderHalftone();
  else if (state.mode === "woodcut") renderWoodcut();
  else renderTechPixel();
}

function createFragment(glow, now) {
  const points = glow.points;
  const minX = Math.floor(Math.min(...points.map((point) => point.x)));
  const minY = Math.floor(Math.min(...points.map((point) => point.y)));
  const maxX = Math.ceil(Math.max(...points.map((point) => point.x)));
  const maxY = Math.ceil(Math.max(...points.map((point) => point.y)));
  const snapshot = document.createElement("canvas");
  snapshot.width = Math.max(1, maxX - minX);
  snapshot.height = Math.max(1, maxY - minY);
  const snapshotContext = snapshot.getContext("2d");
  snapshotContext.save();
  snapshotContext.translate(-minX, -minY);
  pathOn(snapshotContext, points);
  snapshotContext.clip();
  snapshotContext.drawImage(baseCanvas, 0, 0);
  snapshotContext.restore();
  state.holes.push(points);
  rebuildHoleShadows();
  // ponytail: 物理形狀用凸包，接近視覺形狀又免多邊形分解；凹形的凹口處堆疊會些微懸空
  const hull = convexHull(points.map((point) => ({ x: point.x - minX, y: point.y - minY })));
  if (hull.length < 3) return;
  const centroid = Vertices.centre(hull);
  const body = Bodies.fromVertices(minX + centroid.x, minY + centroid.y, [hull], {
    restitution: 0.35,
    friction: 0.6,
    frictionAir: 0.005
  });
  if (!body) return; // 退化形狀建不出剛體就只留洞
  MatterBody.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: 0 });
  MatterBody.setAngularVelocity(body, (Math.random() - 0.5) * 0.1);
  Composite.add(engine.world, body);
  state.fragments.push({
    image: snapshot,
    body,
    offsetX: centroid.x,
    offsetY: centroid.y,
    scale: 1,
    stillSince: 0,
    restStart: 0
  });
}

// Andrew 單調鏈凸包
function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function updateWorld(now, dt) {
  const remainingGlows = [];
  for (const glow of state.glows) {
    if (now - glow.start >= 1000) createFragment(glow, now);
    else remainingGlows.push(glow);
  }
  state.glows = remainingGlows;

  // 固定 timestep 累積器：一幀最多補 3 步，低 FPS 時物理速度不會跟著幀率變慢
  state.physicsAccum = Math.min(state.physicsAccum + dt * 1000, 50);
  let steps = 0;
  while (state.physicsAccum >= 16.67 && steps < 3) {
    MatterEngine.update(engine, 16.67);
    state.physicsAccum -= 16.67;
    steps += 1;
  }

  const keep = [];
  for (const fragment of state.fragments) {
    const body = fragment.body;
    // 幾乎靜止並持續 0.4 秒視為落定，開始 8 秒停留計時；被撞飛或支撐消失會再動，但計時不重來
    if (body.speed < 0.2 && body.angularSpeed < 0.02) {
      if (!fragment.stillSince) fragment.stillSince = now;
      if (!fragment.restStart && now - fragment.stillSince > 400) fragment.restStart = now;
    } else {
      fragment.stillSince = 0;
    }
    // 落定 8 秒後淡出 0.6 秒移除；移除剛體後，堆在上面的碎片會自動掉落
    if (fragment.restStart && now - fragment.restStart >= 8600) {
      Composite.remove(engine.world, body);
    } else {
      keep.push(fragment);
    }
  }
  state.fragments = keep;
}

function drawWorld(now) {
  context.clearRect(0, 0, state.width, state.height);
  context.drawImage(baseCanvas, 0, 0);
  const needsEffect = state.holes.length || state.glows.length || state.fragments.length;
  // ponytail: 特效節流到約 30fps，halftone/matrix 顆粒調到最細時全速跑不動
  if (needsEffect && now - state.lastEffectTime >= 33) {
    renderEffect(now);
    state.lastEffectTime = now;
  }
  for (const hole of state.holes) {
    context.save();
    pathOn(context, hole);
    context.clip();
    context.drawImage(effectCanvas, 0, 0, state.width, state.height);
    context.restore();
  }
  if (state.holes.length) context.drawImage(shadowCanvas, 0, 0);
  for (const glow of state.glows) {
    const progress = Math.min(1, (now - glow.start) / 1000);
    context.save();
    pathOn(context, glow.points);
    context.fillStyle = `rgba(255,255,255,${progress * 0.15})`;
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.98)";
    context.lineWidth = 4;
    context.shadowColor = "white";
    context.shadowBlur = 10 + progress * 30;
    context.stroke();
    context.restore();
  }
  for (const fragment of state.fragments) {
    const alpha = fragment.restStart
      ? Math.min(1, Math.max(0, 1 - (now - fragment.restStart - 8000) / 600))
      : 1;
    context.save();
    context.globalAlpha = alpha;
    context.translate(fragment.body.position.x, fragment.body.position.y);
    context.rotate(fragment.body.angle);
    context.scale(fragment.scale, fragment.scale);
    // 剛體繞質心旋轉，貼圖以凸包質心對位
    context.drawImage(fragment.image, -fragment.offsetX, -fragment.offsetY);
    context.restore();
  }
  if (state.path.length > 1) {
    const alpha = state.pathFadeStart ? Math.max(0, 1 - (now - state.pathFadeStart) / 300) : 1;
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(state.path[0].x, state.path[0].y);
    for (let i = 1; i < state.path.length; i += 1) context.lineTo(state.path[i].x, state.path[i].y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = "white";
    // 外圈粗光暈＋內圈亮芯，兩道描邊讓線條又粗又亮
    context.strokeStyle = "rgba(255,255,255,0.4)";
    context.lineWidth = 12;
    context.shadowBlur = 32;
    context.stroke();
    context.strokeStyle = "white";
    context.lineWidth = 6;
    context.shadowBlur = 18;
    context.stroke();
    context.restore();
  }
  if (!state.holes.length && !state.path.length) drawPrompt();
  if (state.fingertip) drawFingertip(now);
}

function drawFingertip(now) {
  // 確認期光點由小變大，蓄滿（armed）後保持亮光，提示可以開始畫
  const progress = state.armed ? 1 : Math.min(1, (now - state.holdStart) / 500);
  context.save();
  context.fillStyle = `rgba(255,255,255,${0.35 + progress * 0.6})`;
  context.shadowColor = "white";
  context.shadowBlur = 8 + progress * 24;
  context.beginPath();
  context.arc(state.fingertip.x, state.fingertip.y, 5 + progress * 7, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawPrompt() {
  const text = "伸出食指停住半秒，指尖發光後畫出封閉形狀";
  const y = state.height - 58;
  context.save();
  context.font = "600 18px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(text).width + 42;
  context.fillStyle = "rgba(0,0,0,0.55)";
  context.beginPath();
  context.roundRect((state.width - width) / 2, y - 22, width, 44, 22);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.92)";
  context.fillText(text, state.width / 2, y);
  context.restore();
}

function render(landmarker, frameTime) {
  const now = frameTime || performance.now();
  const dt = Math.min(0.05, state.previousFrameTime ? (now - state.previousFrameTime) / 1000 : 0);
  state.previousFrameTime = now;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (!state.hasVideoFrame) {
      state.hasVideoFrame = true;
      shell.hideLoading();
    }
    drawMirroredVideo(baseContext, state.width, state.height);
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      state.hand = (result.landmarks || [])[0] || null;
      // 手勢狀態機只在有新偵測結果時前進，影像停滯時不會用舊手勢累積蓄力
      updateHand(state.hand, now);
    }
    updateWorld(now, dt);
    drawWorld(now);
  }
  state.animationId = window.requestAnimationFrame((time) => render(landmarker, time));
}

async function setupCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") throw new Error("mediaDevices unavailable");
  const request = navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  const timeout = new Promise((resolve, reject) => {
    window.setTimeout(() => reject(new Error("camera permission timeout")), 20000);
  });
  video.srcObject = await Promise.race([request, timeout]);
  await video.play();
}

async function start() {
  try {
    shell.showLoading("正在開啟相機，請稍候…");
    resize();
    await setupCamera();
    const fileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/hand_landmarker.task" },
      runningMode: "VIDEO",
      numHands: 1,
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
  if (stream) for (const track of stream.getTracks()) track.stop();
  Composite.clear(engine.world, false);
  MatterEngine.clear(engine);
  floorBody = null;
});

start();
