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

const state = {
  width: 1,
  height: 1,
  mode: "tech-pixel",
  fallSpeed: 1,
  grain: 12,
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
  lastEffectTime: 0
};

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const matrixAlphabet = "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789@#$%&*";

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
  key: "fallSpeed",
  label: "掉落速度",
  min: 0.5,
  max: 3,
  step: 0.1,
  value: state.fallSpeed,
  onChange(value) {
    state.fallSpeed = Number(value);
  }
});

shell.addButton({
  label: "重置世界",
  onClick() {
    state.holes = [];
    state.glows = [];
    state.fragments = [];
    state.path = [];
    state.pathFadeStart = 0;
    state.armed = false;
    state.holdStart = 0;
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
    for (const fragment of state.fragments) {
      fragment.x *= sx;
      fragment.y *= sy;
      fragment.centerX *= sx;
      fragment.centerY *= sy;
      fragment.scaleX *= sx;
      fragment.scaleY *= sy;
    }
  }
  state.width = width;
  state.height = height;
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
  baseCanvas.width = canvas.width;
  baseCanvas.height = canvas.height;
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

function renderTechPixel() {
  const grid = state.grain;
  const size = prepareSample(grid);
  const image = sampleContext.getImageData(0, 0, size.cols, size.rows);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = Math.round(image.data[i] / 85) * 70;
    image.data[i + 1] = Math.min(255, Math.round(image.data[i + 1] / 85) * 85 + 18);
    image.data[i + 2] = Math.min(255, Math.round(image.data[i + 2] / 85) * 85 + 30);
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
  }
  effectContext.fillStyle = "#020604";
  effectContext.fillRect(0, 0, size.width, size.height);
  effectContext.font = `700 ${cell}px monospace`;
  effectContext.textAlign = "center";
  effectContext.textBaseline = "middle";
  for (let y = 0; y < size.rows; y += 1) {
    for (let x = 0; x < size.cols; x += 1) {
      const index = y * size.cols + x;
      if (Math.random() < 0.05) state.matrixChars[index] = Math.floor(Math.random() * matrixAlphabet.length);
      const p = index * 4;
      const light = (pixels[p] * 0.21 + pixels[p + 1] * 0.72 + pixels[p + 2] * 0.07) / 255;
      const head = Math.floor(state.matrixColumns[x] + now * 0.004) % size.rows === y;
      effectContext.fillStyle = head ? "rgba(235,255,242,0.98)" : `rgba(0,255,102,${0.12 + light * 0.82})`;
      effectContext.fillText(matrixAlphabet[state.matrixChars[index]], x * cell + cell / 2, y * cell + cell / 2);
    }
  }
}

function renderHalftone() {
  const cell = state.grain;
  const size = prepareSample(cell);
  const pixels = sampleContext.getImageData(0, 0, size.cols, size.rows).data;
  effectContext.fillStyle = "#f2ead8";
  effectContext.fillRect(0, 0, size.width, size.height);
  for (let y = 0; y < size.rows; y += 1) {
    for (let x = 0; x < size.cols; x += 1) {
      const p = (y * size.cols + x) * 4;
      const darkness = 1 - (pixels[p] * 0.21 + pixels[p + 1] * 0.72 + pixels[p + 2] * 0.07) / 255;
      const radius = darkness * cell * 0.65;
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
  const width = 240;
  const height = Math.max(1, Math.round(width * state.height / state.width));
  if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
    sampleCanvas.width = width;
    sampleCanvas.height = height;
  }
  drawMirroredVideo(sampleContext, width, height);
  const image = sampleContext.getImageData(0, 0, width, height);
  const palette = [[26, 22, 20], [200, 69, 44], [232, 217, 184], [245, 239, 224]];
  for (let i = 0; i < image.data.length; i += 4) {
    const light = image.data[i] * 0.21 + image.data[i + 1] * 0.72 + image.data[i + 2] * 0.07;
    const color = palette[Math.min(3, Math.floor(light / 64))];
    image.data[i] = color[0];
    image.data[i + 1] = color[1];
    image.data[i + 2] = color[2];
  }
  sampleContext.putImageData(image, 0, 0);
  const outputHeight = Math.max(1, Math.round(480 * state.height / state.width));
  if (effectCanvas.width !== 480 || effectCanvas.height !== outputHeight) {
    effectCanvas.width = 480;
    effectCanvas.height = outputHeight;
  }
  effectContext.imageSmoothingEnabled = false;
  effectContext.drawImage(sampleCanvas, 0, 0, effectCanvas.width, effectCanvas.height);
}

function renderEffect(now) {
  if (state.mode === "matrix") renderMatrix(now);
  else if (state.mode === "halftone") renderHalftone();
  else if (state.mode === "woodcut") renderWoodcut();
  else renderTechPixel();
}

function createFragment(glow) {
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
  state.fragments.push({
    image: snapshot,
    x: minX,
    y: minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    vx: Math.random() * 60 - 30,
    vy: 0,
    angle: 0,
    angularVelocity: Math.random() * 1.6 - 0.8,
    scaleX: 1,
    scaleY: 1
  });
}

function updateWorld(now, dt) {
  const remainingGlows = [];
  for (const glow of state.glows) {
    if (now - glow.start >= 1000) createFragment(glow);
    else remainingGlows.push(glow);
  }
  state.glows = remainingGlows;
  for (const fragment of state.fragments) {
    fragment.vy += 1800 * state.fallSpeed * dt;
    fragment.x += fragment.vx * dt;
    fragment.y += fragment.vy * dt;
    fragment.centerX += fragment.vx * dt;
    fragment.centerY += fragment.vy * dt;
    fragment.angle += fragment.angularVelocity * dt;
  }
  // 用旋轉後的最大半徑（半對角線）判斷完全掉出畫面，避免寬扁碎片旋轉時提早消失
  state.fragments = state.fragments.filter((fragment) => fragment.centerY - Math.hypot(fragment.image.width * fragment.scaleX, fragment.image.height * fragment.scaleY) / 2 < state.height);
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
    context.save();
    pathOn(context, hole);
    context.strokeStyle = "rgba(0,0,0,0.5)";
    context.lineWidth = 3;
    context.stroke();
    context.restore();
  }
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
    context.save();
    context.translate(fragment.centerX, fragment.centerY);
    context.rotate(fragment.angle);
    context.scale(fragment.scaleX, fragment.scaleY);
    context.drawImage(fragment.image, -fragment.image.width / 2, -fragment.image.height / 2);
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
});

start();
