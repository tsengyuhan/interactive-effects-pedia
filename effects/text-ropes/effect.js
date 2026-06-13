import { FilesetResolver, HandLandmarker } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "text-ropes" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");
const textInput = document.createElement("input");

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const fingerTips = [4, 8, 12, 16, 20];
const fingerChains = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20]
];
const nodeCount = 22;
const constraintIterations = 8;

const state = {
  width: 1,
  height: 1,
  lastVideoTime: -1,
  lastFrameTime: 0,
  lastMode: "none",
  animationId: 0,
  hands: [],
  ropes: new Map(),
  beads: new Map(),
  beadCharIndices: new Map(),
  tipVelocities: new Map(),
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

  const start = pins[0].point;
  const end = pins[pins.length - 1].point;
  for (let i = 0; i < nodeCount; i += 1) {
    const t = i / (nodeCount - 1);
    const x = start.x + (end.x - start.x) * t;
    // 初始略向下放，避免雙手繩剛出現時完全筆直。
    const y = start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * totalLength * 0.08;
    nodes.push(makeNode(x, y));
  }

  return { key, nodes, restLength: totalLength / (nodeCount - 1), depth: 0, occluders: [] };
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

function updateRope(key, pins, totalLength, depth, occluders) {
  let rope = state.ropes.get(key);
  if (!rope || Math.abs(rope.nodes.length * rope.restLength - totalLength) > state.height * 0.18) {
    rope = makeRope(key, pins, totalLength);
    state.ropes.set(key, rope);
  }

  rope.restLength = totalLength / (nodeCount - 1);
  rope.depth = depth;
  rope.occluders = occluders;
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

function getOccluders(hand, fingerIndex, depth) {
  const radius = clamp(state.fontSize * 1.25, 18, 58);
  return fingerTips
    .filter((tipIndex, index) => index !== fingerIndex && hand.points[tipIndex].z < depth)
    .map((tipIndex) => ({ point: hand.points[tipIndex], radius }));
}

function buildRopeSpecs(hands) {
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

  let textIndex = 0;
  let cursor = state.fontSize * 0.45;
  while (cursor < polyline.total) {
    const char = text[textIndex % text.length];
    const spacing = Math.max(state.fontSize * 0.55, context.measureText(char).width * state.tightness);
    const point = pointAtLength(polyline, cursor);
    if (point && !isOccluded(point, rope.occluders)) {
      context.save();
      context.translate(point.x, point.y);
      context.rotate(point.angle);
      context.fillText(char, 0, 0);
      context.restore();
    }
    cursor += spacing;
    textIndex += 1;
  }

  context.restore();
}

function clearSingleHandState() {
  state.beads.clear();
  state.beadCharIndices.clear();
  state.tipVelocities.clear();
}

function getNextBeadChar(key, text) {
  const index = state.beadCharIndices.get(key) || 0;
  state.beadCharIndices.set(key, index + 1);
  return text[index % text.length];
}

function measureBeadSpacing(text) {
  let total = 0;
  for (const char of text) {
    total += context.measureText(char).width;
  }
  return Math.max(state.fontSize * 0.6, (total / text.length) * state.tightness);
}

function syncMode(mode) {
  if (state.lastMode !== mode) {
    if (mode !== "single") {
      clearSingleHandState();
    }
    if (mode !== "double") {
      state.ropes.clear();
    }
    state.lastMode = mode;
  }
}

function updateBeads(key, fingerIndex, spacing, totalLength, dt, text) {
  let beads = state.beads.get(key);
  if (!beads || beads.length === 0) {
    const phase = fingerIndex * spacing * 0.2;
    // 初始錯相是為了避免五根手指的字粒全擠在同一個手腕點。
    beads = [{ s: phase, char: getNextBeadChar(key, text) }];
    state.beads.set(key, beads);
  }

  const crawlSpeed = state.height * 0.12;
  for (const bead of beads) {
    bead.s += crawlSpeed * dt;
  }

  const nearestWrist = beads.reduce((min, bead) => Math.min(min, bead.s), Number.POSITIVE_INFINITY);
  let nextS = nearestWrist;
  while (nextS > spacing) {
    nextS -= spacing;
    beads.unshift({ s: nextS, char: getNextBeadChar(key, text) });
  }

  const alive = beads.filter((bead) => bead.s <= totalLength);
  state.beads.set(key, alive);
  return alive;
}

function updateTipVelocity(key, tip) {
  const previous = state.tipVelocities.get(key) || { x: tip.x, vx: 0 };
  const vx = previous.vx * 0.75 + (tip.x - previous.x) * 0.25;
  state.tipVelocities.set(key, { x: tip.x, vx });
  return vx;
}

function getDangleSway(handVelX, ds, dangleMax, time) {
  const gravityFactor = clamp(state.gravity, 0.4, 3);
  return Math.sin(time * 2 + ds * 0.03) * ds * 0.05 / gravityFactor
    + handVelX * clamp(ds / dangleMax, 0, 1) * 6 / gravityFactor;
}

function drawSingleHandBeads(hand, dt) {
  const text = state.text.trim() || "互動設計實驗";
  const time = performance.now() * 0.001;
  const dangleMax = state.height * 0.3;

  context.save();
  context.font = `${state.weight} ${state.fontSize}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = state.color;
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 6;

  const spacing = measureBeadSpacing(text);

  for (const [fingerIndex, chain] of fingerChains.entries()) {
    const key = `single-${hand.id}-${fingerIndex}`;
    const points = chain.map((pointIndex) => hand.points[pointIndex]);
    const tip = points[points.length - 1];
    const polyline = getPolylineSamples(points);
    const totalLength = polyline.total + dangleMax;
    const occluders = getOccluders(hand, fingerIndex, tip.z);
    const beads = updateBeads(key, fingerIndex, spacing, totalLength, dt, text);
    const handVelX = updateTipVelocity(key, tip);

    for (const bead of beads) {
      let drawPoint = null;
      let angle = Math.PI / 2;
      let alpha = 1;
      let onHand = false;

      if (bead.s <= polyline.total) {
        const point = pointAtLength(polyline, bead.s);
        if (!point) {
          continue;
        }
        // 法線波動讓字粒不是硬貼折線，而是有爬行的蠕動感。
        const normal = { x: -Math.sin(point.angle), y: Math.cos(point.angle) };
        const wig = Math.sin(bead.s * 0.05 - time * 6) * state.fontSize * 0.22;
        drawPoint = {
          x: point.x + normal.x * wig,
          y: point.y + normal.y * wig
        };
        angle = point.angle;
        onHand = true;
      } else {
        const ds = bead.s - polyline.total;
        const fadeZone = dangleMax * 0.25;
        const sway = getDangleSway(handVelX, ds, dangleMax, time);
        drawPoint = {
          x: tip.x + sway,
          y: tip.y + ds
        };
        alpha = ds > dangleMax - fadeZone ? clamp((dangleMax - ds) / fadeZone, 0, 1) : 1;
      }

      if (!drawPoint || (onHand && isOccluded(drawPoint, occluders))) {
        continue;
      }

      context.save();
      context.globalAlpha = alpha;
      context.translate(drawPoint.x, drawPoint.y);
      context.rotate(angle);
      context.fillText(bead.char, 0, 0);
      context.restore();
    }
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

function updateAndDrawRopes(dt) {
  if (state.hands.length === 0) {
    syncMode("none");
    drawPrompt();
    return;
  }

  if (state.hands.length === 1) {
    syncMode("single");
    drawSingleHandBeads(state.hands[0], dt);
    return;
  }

  syncMode("double");
  const specs = buildRopeSpecs(state.hands);
  const activeKeys = new Set(specs.map((spec) => spec.key));
  pruneRopes(activeKeys);

  if (specs.length === 0) {
    drawPrompt();
    return;
  }

  const ropes = specs
    .map((spec) => updateRope(spec.key, spec.pins, spec.totalLength, spec.depth, spec.occluders))
    .sort((a, b) => b.depth - a.depth);

  for (const rope of ropes) {
    drawTextRope(rope);
  }
}

function render(landmarker) {
  const now = performance.now();
  const dt = state.lastFrameTime ? clamp((now - state.lastFrameTime) / 1000, 0, 0.05) : 0;
  state.lastFrameTime = now;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    drawMirroredVideo();
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      state.hands = (result.landmarks || []).map(analyzeHand);
    }
    updateAndDrawRopes(dt);
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
