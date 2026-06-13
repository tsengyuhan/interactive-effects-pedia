import { FilesetResolver, HandLandmarker } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "text-ropes" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");
const textInput = document.createElement("input");

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const fingerTips = [4, 8, 12, 16, 20];
// 各指第二指節（拇指 IP、其餘 PIP）——單手時文字繩對折掛在手指肚附近，而非指尖
const secondKnuckles = [3, 6, 10, 14, 18];
const fingerMcps = [2, 5, 9, 13, 17];
const nodeCount = 22;
const constraintIterations = 8;
const foldBand = 0.06;

const state = {
  width: 1,
  height: 1,
  lastVideoTime: -1,
  animationId: 0,
  hands: [],
  ropes: new Map(),
  text: "互動設計實驗",
  fontSize: 24,
  weight: 600,
  color: "#ffffff",
  tightness: 1,
  gravity: 1.4
};

canvas.style.position = "absolute";
canvas.style.inset = "0";
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";

video.muted = true;
video.playsInline = true;
video.style.display = "none";

textInput.type = "text";
textInput.value = state.text;
textInput.placeholder = "輸入文字…";
textInput.setAttribute("aria-label", "輸入文字繩內容");
textInput.style.position = "absolute";
textInput.style.left = "50%";
textInput.style.top = "18px";
textInput.style.transform = "translateX(-50%)";
textInput.style.zIndex = "3";
textInput.style.width = "min(420px, calc(100vw - 36px))";
textInput.style.boxSizing = "border-box";
textInput.style.border = "1px solid rgba(255, 255, 255, 0.2)";
textInput.style.borderRadius = "8px";
textInput.style.padding = "11px 14px";
textInput.style.background = "rgba(0, 0, 0, 0.56)";
textInput.style.color = "#ffffff";
textInput.style.font = "16px/1.35 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
textInput.style.outline = "none";
textInput.style.backdropFilter = "blur(12px)";

shell.container.style.overflow = "hidden";
shell.container.style.background = "#05070a";
shell.container.append(video, canvas, textInput);

shell.addParam({
  key: "fontSize",
  type: "range",
  label: "字的大小",
  min: 12,
  max: 48,
  step: 1,
  value: state.fontSize,
  onChange(value) {
    state.fontSize = value;
  }
});

shell.addParam({
  key: "color",
  type: "color",
  label: "字的顏色",
  value: state.color,
  onChange(value) {
    state.color = value;
  }
});

shell.addParam({
  key: "weight",
  type: "range",
  label: "字的粗細",
  min: 300,
  max: 900,
  step: 100,
  value: state.weight,
  onChange(value) {
    state.weight = value;
  }
});

shell.addParam({
  key: "tightness",
  type: "range",
  label: "字的緊密度",
  min: 0.6,
  max: 1.8,
  step: 0.05,
  value: state.tightness,
  onChange(value) {
    state.tightness = value;
  }
});

shell.addParam({
  key: "gravity",
  type: "range",
  label: "重力",
  min: 0.4,
  max: 3,
  step: 0.1,
  value: state.gravity,
  onChange(value) {
    state.gravity = value;
  }
});

textInput.addEventListener("input", () => {
  state.text = textInput.value || textInput.placeholder;
});

function resize() {
  state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  canvas.width = Math.floor(state.width);
  canvas.height = Math.floor(state.height);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

function normalize2D(vector, fallback = { x: 0, y: 1 }) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.0001) {
    return fallback;
  }
  return { x: vector.x / length, y: vector.y / length };
}

function normalize3D(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.0001) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross3D(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function pointToSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) {
    return distance(point, a);
  }
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  return distance(point, {
    x: a.x + dx * t,
    y: a.y + dy * t
  });
}

function mirrorPoint(point) {
  return {
    x: (1 - point.x) * state.width,
    y: point.y * state.height,
    z: point.z || 0
  };
}

function analyzeHand(landmarks, index) {
  return {
    id: `hand-${index}`,
    points: landmarks.map(mirrorPoint)
  };
}

function drawMirroredVideo() {
  context.save();
  context.clearRect(0, 0, state.width, state.height);
  context.translate(state.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, state.width, state.height);
  context.restore();
}

function makeNode(x, y) {
  return { x, y, px: x, py: y, fixed: false };
}

function makeRope(key, pins, totalLength) {
  const nodes = [];

  if (pins.length === 1) {
    const pin = pins[0];
    const restLength = totalLength / (nodeCount - 1);
    for (let i = 0; i < nodeCount; i += 1) {
      const offset = i - pin.index;
      const swing = Math.sin(i * 0.7) * restLength * 0.12;
      nodes.push(makeNode(pin.point.x + swing, pin.point.y + offset * restLength));
    }
  } else {
    const start = pins[0].point;
    const end = pins[pins.length - 1].point;
    for (let i = 0; i < nodeCount; i += 1) {
      const t = i / (nodeCount - 1);
      const x = start.x + (end.x - start.x) * t;
      // 初始略向下放，避免雙手繩剛出現時完全筆直。
      const y = start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * totalLength * 0.08;
      nodes.push(makeNode(x, y));
    }
  }

  return { key, nodes, restLength: totalLength / (nodeCount - 1), depth: 0, occluders: [], drape: null };
}

function setFixedNode(node, point) {
  node.x = point.x;
  node.y = point.y;
  node.px = point.x;
  node.py = point.y;
  node.fixed = true;
}

function integrate(rope) {
  const gravity = state.gravity * clamp(state.height / 720, 0.7, 1.7);
  for (const node of rope.nodes) {
    if (node.fixed) {
      continue;
    }
    const vx = (node.x - node.px) * 0.96;
    const vy = (node.y - node.py) * 0.96;
    node.px = node.x;
    node.py = node.y;
    node.x += vx;
    node.y += vy + gravity;
  }
}

function satisfyConstraints(rope) {
  for (let iteration = 0; iteration < constraintIterations; iteration += 1) {
    for (let i = 0; i < rope.nodes.length - 1; i += 1) {
      const a = rope.nodes[i];
      const b = rope.nodes[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const current = Math.hypot(dx, dy) || 0.0001;
      const correction = (current - rope.restLength) / current;
      const offsetX = dx * correction * 0.5;
      const offsetY = dy * correction * 0.5;

      if (!a.fixed && !b.fixed) {
        a.x += offsetX;
        a.y += offsetY;
        b.x -= offsetX;
        b.y -= offsetY;
      } else if (a.fixed && !b.fixed) {
        b.x -= offsetX * 2;
        b.y -= offsetY * 2;
      } else if (!a.fixed && b.fixed) {
        a.x += offsetX * 2;
        a.y += offsetY * 2;
      }
    }
  }
}

function updateRope(key, pins, totalLength, depth, occluders, drape = null) {
  let rope = state.ropes.get(key);
  if (!rope || Math.abs(rope.nodes.length * rope.restLength - totalLength) > state.height * 0.18) {
    rope = makeRope(key, pins, totalLength);
    state.ropes.set(key, rope);
  }

  rope.restLength = totalLength / (nodeCount - 1);
  rope.depth = depth;
  rope.occluders = occluders;
  rope.drape = drape;
  for (const node of rope.nodes) {
    node.fixed = false;
  }
  for (const pin of pins) {
    setFixedNode(rope.nodes[pin.index], pin.point);
  }

  integrate(rope);
  satisfyConstraints(rope);
  return rope;
}

function getPalmNormal(hand) {
  const toNormalized3D = (point) => ({
    x: point.x / state.width,
    y: point.y / state.height,
    z: point.z
  });
  const wrist = toNormalized3D(hand.points[0]);
  const indexMcp = toNormalized3D(hand.points[5]);
  const pinkyMcp = toNormalized3D(hand.points[17]);
  const v1 = {
    x: indexMcp.x - wrist.x,
    y: indexMcp.y - wrist.y,
    z: indexMcp.z - wrist.z
  };
  const v2 = {
    x: pinkyMcp.x - wrist.x,
    y: pinkyMcp.y - wrist.y,
    z: pinkyMcp.z - wrist.z
  };
  return normalize3D(cross3D(v1, v2));
}

function getDrapeSpec(hand, fingerIndex, knuckle, tip) {
  const axis = normalize2D({ x: tip.x - knuckle.x, y: tip.y - knuckle.y });
  const perp = { x: -axis.y, y: axis.x };
  const normal = getPalmNormal(hand);
  const tiltSigned = normal.x * perp.x + normal.y * perp.y;
  const fingerWidth = distance(hand.points[0], hand.points[9]) * 0.2;
  const sep = fingerWidth * clamp(0.25 + Math.abs(tiltSigned) * 2.5, 0.25, 1.6);

  return {
    perp,
    sep,
    frontSign: tiltSigned >= 0 ? 1 : -1,
    mcp: hand.points[fingerMcps[fingerIndex]],
    tip,
    fingerWidth,
    foldT: 0.5
  };
}

function getOccluders(hand, fingerIndex, depth) {
  const radius = clamp(state.fontSize * 1.25, 18, 58);
  return fingerTips
    .filter((tipIndex, index) => index !== fingerIndex && hand.points[tipIndex].z < depth)
    .map((tipIndex) => ({ point: hand.points[tipIndex], radius }));
}

function buildRopeSpecs(hands) {
  if (hands.length === 1) {
    const hand = hands[0];
    return fingerTips.map((tipIndex, fingerIndex) => {
      const knuckle = hand.points[secondKnuckles[fingerIndex]];
      const tip = hand.points[tipIndex];
      // 掛點往指尖微移，讓彎折視覺落在手指肚上，比釘在關節更像被手指托住。
      const drapePoint = lerpPoint(knuckle, tip, 0.35);
      const drape = getDrapeSpec(hand, fingerIndex, knuckle, tip);
      return {
        key: `single-${hand.id}-${tipIndex}`,
        pins: [{ index: Math.floor(nodeCount / 2), point: drapePoint }],
        totalLength: state.height * 0.52,
        depth: drapePoint.z,
        occluders: getOccluders(hand, fingerIndex, drapePoint.z),
        drape
      };
    });
  }

  if (hands.length >= 2) {
    const [leftHand, rightHand] = hands;
    return fingerTips.map((tipIndex, fingerIndex) => {
      const start = leftHand.points[tipIndex];
      const end = rightHand.points[tipIndex];
      const ropeDepth = (start.z + end.z) * 0.5;
      return {
        key: `double-${tipIndex}`,
        pins: [
          { index: 0, point: start },
          { index: nodeCount - 1, point: end }
        ],
        totalLength: Math.max(distance(start, end) * 1.18, state.width * 0.12),
        depth: ropeDepth,
        occluders: [
          ...getOccluders(leftHand, fingerIndex, start.z),
          ...getOccluders(rightHand, fingerIndex, end.z)
        ]
      };
    });
  }

  return [];
}

function pruneRopes(activeKeys) {
  for (const key of state.ropes.keys()) {
    if (!activeKeys.has(key)) {
      state.ropes.delete(key);
    }
  }
}

function getPolylineSamples(nodes) {
  const samples = [];
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const length = distance(a, b);
    samples.push({ a, b, start: total, length });
    total += length;
  }
  return { samples, total };
}

function pointAtLength(polyline, target) {
  for (const segment of polyline.samples) {
    if (target <= segment.start + segment.length || segment === polyline.samples[polyline.samples.length - 1]) {
      const t = segment.length <= 0 ? 0 : (target - segment.start) / segment.length;
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * t,
        y: segment.a.y + (segment.b.y - segment.a.y) * t,
        angle: Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x)
      };
    }
  }
  return null;
}

function isOccluded(point, occluders) {
  return occluders.some((occluder) => distance(point, occluder.point) < occluder.radius);
}

function getDrapeDrawState(point, cursor, polyline, drape) {
  const half = cursor / polyline.total;
  const d = half - drape.foldT;
  const ramp = clamp(Math.abs(d) / 0.5, 0, 1);
  const side = d >= 0 ? drape.frontSign : -drape.frontSign;
  return {
    d,
    x: point.x + drape.perp.x * drape.sep * ramp * side,
    y: point.y + drape.perp.y * drape.sep * ramp * side
  };
}

function isInsideOwnFinger(point, drape) {
  return pointToSegmentDistance(point, drape.mcp, drape.tip) < drape.fingerWidth * 0.6;
}

function drawTextRope(rope) {
  const text = state.text.trim() || "互動設計實驗";
  const polyline = getPolylineSamples(rope.nodes);
  if (polyline.total < 4) {
    return;
  }

  context.save();
  context.font = `${state.weight} ${state.fontSize}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = state.color;
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 6;

  const drawPass = (pass) => {
    let textIndex = 0;
    let cursor = state.fontSize * 0.45;
    while (cursor < polyline.total) {
      const char = text[textIndex % text.length];
      const spacing = Math.max(state.fontSize * 0.55, context.measureText(char).width * state.tightness);
      const point = pointAtLength(polyline, cursor);
      if (point) {
        const drapeState = rope.drape ? getDrapeDrawState(point, cursor, polyline, rope.drape) : null;
        const isBack = drapeState ? drapeState.d < -foldBand : false;
        const shouldDraw = pass === "all" || (pass === "back" ? isBack : !isBack);
        const drawPoint = drapeState ? { x: drapeState.x, y: drapeState.y } : point;
        const blockedByOwnFinger = rope.drape && isBack && isInsideOwnFinger(drawPoint, rope.drape);

        if (shouldDraw && !blockedByOwnFinger && !isOccluded(drawPoint, rope.occluders)) {
          context.save();
          context.globalAlpha = isBack ? 0.5 : 1;
          context.translate(drawPoint.x, drawPoint.y);
          context.rotate(point.angle);
          // 後段縮小並先畫，讓前段有明確壓在手指上方的層次。
          if (isBack) {
            context.scale(0.9, 0.9);
          }
          context.fillText(char, 0, 0);
          context.restore();
        }
      }
      cursor += spacing;
      textIndex += 1;
    }
  };

  if (rope.drape) {
    drawPass("back");
    drawPass("front");
  } else {
    drawPass("all");
  }

  context.restore();
}

function drawPrompt() {
  const text = "請面對鏡頭伸出手";
  const y = state.height - 58;
  context.save();
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

function updateAndDrawRopes() {
  const specs = buildRopeSpecs(state.hands);
  const activeKeys = new Set(specs.map((spec) => spec.key));
  pruneRopes(activeKeys);

  if (specs.length === 0) {
    drawPrompt();
    return;
  }

  const ropes = specs
    .map((spec) => updateRope(spec.key, spec.pins, spec.totalLength, spec.depth, spec.occluders, spec.drape))
    .sort((a, b) => b.depth - a.depth);

  for (const rope of ropes) {
    drawTextRope(rope);
  }
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
    updateAndDrawRopes();
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
  // 無裝置或權限提示卡住時，逾時能讓頁面顯示明確錯誤而不是空白。
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
