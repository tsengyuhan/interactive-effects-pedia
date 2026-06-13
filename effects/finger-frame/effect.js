import { FilesetResolver, HandLandmarker } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "finger-frame" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", { willReadFrequently: true });
const video = document.createElement("video");

const state = {
  tolerance: 50,
  mode: "invert",
  blockSize: 16,
  width: 1,
  height: 1,
  ratio: 1,
  lastVideoTime: -1,
  animationId: 0,
  hands: [],
  smoothedCorners: null,
  lastRect: null,
  lastValidTime: 0,
  fadeMs: 500
};

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

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
  type: "range",
  key: "tolerance",
  label: "手勢寬鬆度",
  min: 20,
  max: 70,
  step: 1,
  value: state.tolerance,
  onChange(value) {
    state.tolerance = value;
  }
});

shell.addParam({
  type: "select",
  key: "mode",
  label: "框內特效",
  value: state.mode,
  options: [
    { value: "invert", label: "負片" },
    { value: "mosaic", label: "馬賽克" }
  ],
  onChange(value) {
    state.mode = value;
  }
});

shell.addParam({
  type: "range",
  key: "blockSize",
  label: "馬賽克格子大小",
  min: 4,
  max: 40,
  step: 1,
  value: state.blockSize,
  onChange(value) {
    state.blockSize = value;
  }
});

function resize() {
  state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  // MediaPipe 座標與互動判定都用 CSS 像素，canvas 也維持同一座標系避免框線偏移。
  canvas.width = Math.floor(state.width);
  canvas.height = Math.floor(state.height);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mirrorPoint(point) {
  return {
    x: (1 - point.x) * state.width,
    y: point.y * state.height
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(vector) {
  return Math.hypot(vector.x, vector.y);
}

function angleBetween(a, b) {
  const denominator = length(a) * length(b);
  if (denominator < 0.000001) {
    return 0;
  }
  const cosine = clamp((a.x * b.x + a.y * b.y) / denominator, -1, 1);
  return Math.acos(cosine) * 180 / Math.PI;
}

function analyzeHand(landmarks) {
  const points = landmarks.map(mirrorPoint);
  const p2 = points[2];
  const p4 = points[4];
  const p5 = points[5];
  const p8 = points[8];
  const v1 = subtract(p4, p2);
  const v2 = subtract(p8, p5);
  const theta = angleBetween(v1, v2);
  const valid = Math.abs(theta - 90) <= state.tolerance;

  return {
    points,
    valid,
    corner: {
      x: (p2.x + p5.x) * 0.5,
      y: (p2.y + p5.y) * 0.5
    }
  };
}

function lerpPoint(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount
  };
}

function getRect(corners) {
  const left = Math.floor(Math.min(corners[0].x, corners[1].x));
  const top = Math.floor(Math.min(corners[0].y, corners[1].y));
  const right = Math.ceil(Math.max(corners[0].x, corners[1].x));
  const bottom = Math.ceil(Math.max(corners[0].y, corners[1].y));
  return {
    x: clamp(left, 0, state.width),
    y: clamp(top, 0, state.height),
    w: clamp(right - left, 0, state.width),
    h: clamp(bottom - top, 0, state.height)
  };
}

function normalizeRect(rect) {
  const x = clamp(Math.floor(rect.x), 0, state.width - 1);
  const y = clamp(Math.floor(rect.y), 0, state.height - 1);
  const w = clamp(Math.floor(rect.w), 1, state.width - x);
  const h = clamp(Math.floor(rect.h), 1, state.height - y);
  return { x, y, w, h };
}

function applyInvert(image) {
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

function applyMosaic(image, blockSize) {
  const data = image.data;
  const width = image.width;
  const height = image.height;
  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      const source = (y * width + x) * 4;
      const r = data[source];
      const g = data[source + 1];
      const b = data[source + 2];
      const a = data[source + 3];
      const maxY = Math.min(y + blockSize, height);
      const maxX = Math.min(x + blockSize, width);
      for (let yy = y; yy < maxY; yy += 1) {
        for (let xx = x; xx < maxX; xx += 1) {
          const target = (yy * width + xx) * 4;
          data[target] = r;
          data[target + 1] = g;
          data[target + 2] = b;
          data[target + 3] = a;
        }
      }
    }
  }
}

function applyFrameEffect(rect, alpha) {
  const safeRect = normalizeRect(rect);
  if (safeRect.w < 2 || safeRect.h < 2) {
    return;
  }

  const image = context.getImageData(safeRect.x, safeRect.y, safeRect.w, safeRect.h);
  const original = alpha < 1 ? new Uint8ClampedArray(image.data) : null;
  if (state.mode === "mosaic") {
    applyMosaic(image, state.blockSize);
  } else {
    applyInvert(image);
  }

  if (alpha < 1) {
    // putImageData 不吃 globalAlpha，所以淡出時需手動把效果像素混回原畫面。
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = original[i] + (image.data[i] - original[i]) * alpha;
      image.data[i + 1] = original[i + 1] + (image.data[i + 1] - original[i + 1]) * alpha;
      image.data[i + 2] = original[i + 2] + (image.data[i + 2] - original[i + 2]) * alpha;
    }
  }
  context.putImageData(image, safeRect.x, safeRect.y);
}

function drawMirroredVideo() {
  context.save();
  context.clearRect(0, 0, state.width, state.height);
  context.translate(state.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, state.width, state.height);
  context.restore();
}

function drawHands(hands) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.fillStyle = "rgba(255, 255, 255, 0.62)";
  context.lineWidth = 2;

  for (const hand of hands) {
    for (const [from, to] of handConnections) {
      context.beginPath();
      context.moveTo(hand.points[from].x, hand.points[from].y);
      context.lineTo(hand.points[to].x, hand.points[to].y);
      context.stroke();
    }

    for (const point of hand.points) {
      context.beginPath();
      context.arc(point.x, point.y, 3, 0, Math.PI * 2);
      context.fill();
    }

    if (hand.valid) {
      context.fillStyle = "rgba(255, 255, 255, 0.95)";
      context.strokeStyle = "rgba(0, 0, 0, 0.55)";
      context.lineWidth = 3;
      context.beginPath();
      context.arc(hand.corner.x, hand.corner.y, 8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "rgba(255, 255, 255, 0.62)";
      context.strokeStyle = "rgba(255, 255, 255, 0.42)";
      context.lineWidth = 2;
    }
  }
  context.restore();
}

function drawFrame(rect, alpha) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = "rgba(255, 255, 255, 0.98)";
  context.lineWidth = 4;
  context.shadowColor = "rgba(0, 0, 0, 0.6)";
  context.shadowBlur = 12;
  context.strokeRect(rect.x, rect.y, rect.w, rect.h);
  context.restore();
}

function drawPrompt(alpha) {
  const text = "請雙手比出 L 字手勢";
  const y = state.height - 58;
  context.save();
  context.globalAlpha = alpha;
  context.font = "600 18px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(text).width + 42;
  context.fillStyle = "rgba(0, 0, 0, 0.55)";
  context.beginPath();
  context.roundRect((state.width - width) / 2, y - 22, width, 44, 22);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillText(text, state.width / 2, y);
  context.restore();
}

function updateFrame(hands, now) {
  const validHands = hands.filter((hand) => hand.valid);
  if (validHands.length >= 2) {
    const current = [validHands[0].corner, validHands[1].corner];
    if (!state.smoothedCorners) {
      state.smoothedCorners = current;
    } else {
      state.smoothedCorners = [
        lerpPoint(state.smoothedCorners[0], current[0], 0.4),
        lerpPoint(state.smoothedCorners[1], current[1], 0.4)
      ];
    }
    state.lastRect = getRect(state.smoothedCorners);
    state.lastValidTime = now;
    applyFrameEffect(state.lastRect, 1);
    drawFrame(state.lastRect, 1);
    return;
  }

  state.smoothedCorners = null;
  if (state.lastRect) {
    const alpha = clamp(1 - (now - state.lastValidTime) / state.fadeMs, 0, 1);
    if (alpha > 0) {
      applyFrameEffect(state.lastRect, alpha);
      drawFrame(state.lastRect, alpha);
    }
  }
  drawPrompt(0.95);
}

function render(landmarker) {
  const now = performance.now();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    drawMirroredVideo();
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      state.hands = (result.landmarks || []).map(analyzeHand);
    }
    updateFrame(state.hands, now);
    drawHands(state.hands);
  }
  state.animationId = window.requestAnimationFrame(() => render(landmarker));
}

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
  // 無攝影機或 headless 環境可能讓權限請求懸置，逾時可避免使用者看到空畫面。
  const stream = await Promise.race([request, timeout]);
  video.srcObject = stream;
  await video.play();
}

async function start() {
  try {
    resize();
    await setupCamera();
    const fileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/hand_landmarker.task" },
      runningMode: "VIDEO",
      numHands: 2,
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
