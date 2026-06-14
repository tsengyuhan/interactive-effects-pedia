import { FilesetResolver, HandLandmarker, ImageSegmenter } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "text-ropes" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const mirroredVideoCanvas = document.createElement("canvas");
const mirroredVideoContext = mirroredVideoCanvas.getContext("2d");
const handMaskCanvas = document.createElement("canvas");
const handMaskContext = handMaskCanvas.getContext("2d");
const handShapeCanvas = document.createElement("canvas");
const handShapeContext = handShapeCanvas.getContext("2d");
const handCutoutCanvas = document.createElement("canvas");
const handCutoutContext = handCutoutCanvas.getContext("2d");
const video = document.createElement("video");
const textInput = document.createElement("input");

const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
const fingerTips = [4, 8, 12, 16, 20];
const nodeCount = 22;
const constraintIterations = 8;
const handModeStyle = {
  background: "#357fc5",
  personThreshold: 0.18,
  wristPadding: 30,
  palmPadding: 70,
  edgeSize: 3,
  edgeJitter: 1.2,
  shadowBlur: 20,
  shadowOffsetX: 0,
  shadowOffsetY: 12,
  shadowColor: "rgba(12, 38, 68, 0.34)"
};
const TORN_PAPER_FILTER_ID = "tr-torn-paper-displace";
const SUPPORTS_CTX_FILTER = (() => {
  try {
    const probe = document.createElement("canvas").getContext("2d");
    return probe && "filter" in probe;
  } catch (error) {
    return false;
  }
})();
let visionFileset = null;
let segmenterPromise = null;

const state = {
  width: 1,
  height: 1,
  lastVideoTime: -1,
  hasVideoFrame: false,
  animationId: 0,
  hands: [],
  personMask: null,
  segmenter: null,
  ropes: new Map(),
  text: "互動設計實驗",
  fontSize: 24,
  weight: 6,
  color: "#ffffff",
  tightness: 1,
  ropeLength: 0.45,
  gravity: 1.4,
  display: "full"
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
  key: "display",
  type: "select",
  label: "顯示模式",
  value: state.display,
  options: [
    { value: "full", label: "完整畫面" },
    { value: "hand", label: "純手部模式" }
  ],
  onChange(value) {
    state.display = value;
  }
});

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
  key: "weight",
  type: "range",
  label: "字的粗細",
  min: 1,
  max: 10,
  step: 1,
  value: state.weight,
  onChange(value) {
    state.weight = value;
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
  key: "tightness",
  type: "range",
  label: "字的緊密度",
  min: 0.4,
  max: 3,
  step: 0.05,
  value: state.tightness,
  onChange(value) {
    state.tightness = value;
  }
});

shell.addParam({
  key: "ropeLength",
  type: "range",
  label: "文字繩長度",
  min: 0.2,
  max: 0.9,
  step: 0.05,
  value: state.ropeLength,
  onChange(value) {
    state.ropeLength = value;
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
  mirroredVideoCanvas.width = canvas.width;
  mirroredVideoCanvas.height = canvas.height;
  handMaskCanvas.width = canvas.width;
  handMaskCanvas.height = canvas.height;
  handShapeCanvas.width = canvas.width;
  handShapeCanvas.height = canvas.height;
  handCutoutCanvas.width = canvas.width;
  handCutoutCanvas.height = canvas.height;
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

function drawMirroredVideoTo(targetContext) {
  targetContext.save();
  targetContext.clearRect(0, 0, state.width, state.height);
  targetContext.translate(state.width, 0);
  targetContext.scale(-1, 1);
  targetContext.drawImage(video, 0, 0, state.width, state.height);
  targetContext.restore();
}

function readPersonMask(result) {
  if (!result || !result.confidenceMasks || !result.confidenceMasks[0]) {
    return null;
  }
  const mask = result.confidenceMasks[0];
  return {
    width: mask.width,
    height: mask.height,
    data: mask.getAsFloat32Array()
  };
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

function injectTornPaperFilter() {
  if (!SUPPORTS_CTX_FILTER || document.getElementById(TORN_PAPER_FILTER_ID)) {
    return;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.pointerEvents = "none";
  svg.innerHTML =
    `<filter id="${TORN_PAPER_FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.052" numOctaves="2" seed="23" stitchTiles="stitch" result="noise"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="5.5" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;
  document.body.appendChild(svg);
}

function getHandLineWidth(hand) {
  const palmWidth = distance(hand.points[5], hand.points[17]);
  return clamp(palmWidth * 0.34, 14, 72);
}

function drawHandPolyline(points, lineWidth) {
  if (points.length < 2) {
    return;
  }
  handShapeContext.lineWidth = lineWidth;
  handShapeContext.beginPath();
  handShapeContext.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    handShapeContext.lineTo(points[i].x, points[i].y);
  }
  handShapeContext.stroke();
}

function drawHandShape(hand) {
  if (!hand || hand.points.length < 21) {
    return;
  }

  const lineWidth = getHandLineWidth(hand);
  const fingerLineWidth = lineWidth * 1.22;
  handShapeContext.fillStyle = "#ffffff";
  handShapeContext.strokeStyle = "#ffffff";
  handShapeContext.lineWidth = lineWidth;
  handShapeContext.lineCap = "round";
  handShapeContext.lineJoin = "round";

  // 手掌多邊形先以重心為基準往外撐 palmPadding，把兩側魚際肉與掌根包進來（超集）；
  // 多出來的部分後面會被 person mask 修回真手輪廓，所以撐大是安全的。
  const palmIndices = [0, 1, 5, 9, 13, 17];
  const rawPalm = palmIndices.map((index) => hand.points[index]);
  const palmHull = {
    x: rawPalm.reduce((sum, p) => sum + p.x, 0) / rawPalm.length,
    y: rawPalm.reduce((sum, p) => sum + p.y, 0) / rawPalm.length
  };
  const palmPoints = rawPalm.map((p) => {
    const dx = p.x - palmHull.x;
    const dy = p.y - palmHull.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p.x + (dx / len) * handModeStyle.palmPadding,
      y: p.y + (dy / len) * handModeStyle.palmPadding
    };
  });
  handShapeContext.beginPath();
  handShapeContext.moveTo(palmPoints[0].x, palmPoints[0].y);
  for (let i = 1; i < palmPoints.length; i += 1) {
    handShapeContext.lineTo(palmPoints[i].x, palmPoints[i].y);
  }
  handShapeContext.closePath();
  handShapeContext.fill();
  handShapeContext.stroke();

  const palmRootRadius = clamp(lineWidth * 0.95, 16, 70);
  handShapeContext.beginPath();
  handShapeContext.arc(hand.points[0].x, hand.points[0].y, palmRootRadius, 0, Math.PI * 2);
  handShapeContext.fill();

  const wrist = hand.points[0];
  const palmCenter = [5, 9, 13, 17].reduce(
    (center, index) => {
      center.x += hand.points[index].x / 4;
      center.y += hand.points[index].y / 4;
      return center;
    },
    { x: 0, y: 0 }
  );
  const wristDirectionX = wrist.x - palmCenter.x;
  const wristDirectionY = wrist.y - palmCenter.y;
  const wristDirectionLength = Math.hypot(wristDirectionX, wristDirectionY) || 1;
  const wristExtend = distance(hand.points[5], hand.points[17]) * 0.3;
  handShapeContext.lineWidth = lineWidth;
  handShapeContext.beginPath();
  handShapeContext.moveTo(wrist.x, wrist.y);
  handShapeContext.lineTo(
    wrist.x + (wristDirectionX / wristDirectionLength) * wristExtend,
    wrist.y + (wristDirectionY / wristDirectionLength) * wristExtend
  );
  handShapeContext.stroke();

  const fingers = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20]
  ];
  for (const finger of fingers) {
    drawHandPolyline(finger.map((index) => hand.points[index]), fingerLineWidth);
  }

  const fingertipRadius = fingerLineWidth * 0.52;
  for (const tipIndex of fingerTips) {
    const tip = hand.points[tipIndex];
    handShapeContext.beginPath();
    handShapeContext.arc(tip.x, tip.y, fingertipRadius, 0, Math.PI * 2);
    handShapeContext.fill();
  }
}

function getWristCut(hand) {
  const wrist = hand.points[0];
  const palmCenter = [5, 9, 13, 17].reduce(
    (center, index) => {
      center.x += hand.points[index].x / 4;
      center.y += hand.points[index].y / 4;
      return center;
    },
    { x: 0, y: 0 }
  );
  const dx = palmCenter.x - wrist.x;
  const dy = palmCenter.y - wrist.y;
  const length = Math.hypot(dx, dy) || 1;
  const handDirectionX = dx / length;
  const handDirectionY = dy / length;
  const cutX = wrist.x - handDirectionX * handModeStyle.wristPadding;
  const cutY = wrist.y - handDirectionY * handModeStyle.wristPadding;

  return { x: cutX, y: cutY, normalX: handDirectionX, normalY: handDirectionY };
}

function isInsideWristCut(cut, x, y) {
  return (x - cut.x) * cut.normalX + (y - cut.y) * cut.normalY >= 0;
}

function drawHandShapeMask() {
  handShapeContext.setTransform(1, 0, 0, 1, 0, 0);
  handShapeContext.clearRect(0, 0, state.width, state.height);
  for (const hand of state.hands) {
    drawHandShape(hand);
  }
}

function writeHandMask(mask) {
  handMaskContext.setTransform(1, 0, 0, 1, 0, 0);
  handMaskContext.clearRect(0, 0, state.width, state.height);
  if (state.hands.length === 0) {
    return;
  }

  drawHandShapeMask();

  const width = handMaskCanvas.width;
  const height = handMaskCanvas.height;
  const image = handMaskContext.createImageData(width, height);
  const pixels = image.data;
  const shapePixels = handShapeContext.getImageData(0, 0, width, height).data;
  const wristCuts = state.hands.map(getWristCut);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (shapePixels[index + 3] === 0 || mirroredPersonMaskAt(mask, x, y) < handModeStyle.personThreshold) {
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

  handMaskContext.putImageData(image, 0, 0);
}

function drawPaperEdge() {
  injectTornPaperFilter();

  context.save();
  context.shadowColor = handModeStyle.shadowColor;
  context.shadowBlur = handModeStyle.shadowBlur;
  context.shadowOffsetX = handModeStyle.shadowOffsetX;
  context.shadowOffsetY = handModeStyle.shadowOffsetY;
  context.drawImage(handMaskCanvas, 0, 0);
  context.restore();

  context.save();
  context.globalAlpha = 0.96;
  if (SUPPORTS_CTX_FILTER) {
    context.filter = `url(#${TORN_PAPER_FILTER_ID})`;
  }
  const rings = Math.max(3, Math.round(handModeStyle.edgeSize * 2));
  for (let i = 0; i < rings; i += 1) {
    const angle = i * 2.399963229728653;
    const radius = handModeStyle.edgeSize * (0.65 + (i % 3) * 0.18);
    const jitter = handModeStyle.edgeJitter * Math.sin(i * 12.9898);
    const x = Math.cos(angle) * (radius + jitter);
    const y = Math.sin(angle) * (radius - jitter);
    context.drawImage(handMaskCanvas, x, y);
  }
  context.restore();
}

function drawHandOnlyBackground(mask) {
  context.save();
  context.clearRect(0, 0, state.width, state.height);
  context.fillStyle = handModeStyle.background;
  context.fillRect(0, 0, state.width, state.height);
  context.restore();

  writeHandMask(mask);
  if (state.hands.length === 0) {
    return;
  }

  drawMirroredVideoTo(mirroredVideoContext);

  handCutoutContext.setTransform(1, 0, 0, 1, 0, 0);
  handCutoutContext.clearRect(0, 0, state.width, state.height);
  handCutoutContext.drawImage(mirroredVideoCanvas, 0, 0);
  handCutoutContext.globalCompositeOperation = "destination-in";
  handCutoutContext.drawImage(handMaskCanvas, 0, 0);
  handCutoutContext.globalCompositeOperation = "source-over";

  drawPaperEdge();
  context.drawImage(handCutoutCanvas, 0, 0);
}

function makeNode(x, y) {
  return { x, y, px: x, py: y, fixed: false };
}

function makeRope(key, pins, totalLength) {
  const nodes = [];

  const start = pins[0].point;
  if (pins.length === 1) {
    const restLength = totalLength / (nodeCount - 1);
    for (let i = 0; i < nodeCount; i += 1) {
      // 單手一端固定，初始往下排開可避免所有節點擠在指尖造成第一幀爆衝。
      const sway = Math.sin(i * 0.9 + key.length) * restLength * 0.18;
      nodes.push(makeNode(start.x + sway, start.y + i * restLength));
    }
  } else {
    const end = pins[pins.length - 1].point;
    for (let i = 0; i < nodeCount; i += 1) {
      const t = i / (nodeCount - 1);
      const x = start.x + (end.x - start.x) * t;
      // 初始略向下放，避免雙手繩剛出現時完全筆直。
      const y = start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * totalLength * 0.08;
      nodes.push(makeNode(x, y));
    }
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
  if (hands.length === 1) {
    const [hand] = hands;
    return fingerTips.map((tipIndex, fingerIndex) => {
      const tip = hand.points[tipIndex];
      return {
        key: `single-${hand.id}-${tipIndex}`,
        pins: [{ index: 0, point: tip }],
        totalLength: state.height * state.ropeLength,
        depth: tip.z,
        occluders: getOccluders(hand, fingerIndex, tip.z)
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

function drawTextRope(rope) {
  const text = state.text.trim() || "互動設計實驗";
  const polyline = getPolylineSamples(rope.nodes);
  if (polyline.total < 4) {
    return;
  }

  context.save();
  const fontWeight = clamp(Math.round(100 + state.weight * 90), 100, 900);
  const strokeWidth = Math.max(0, state.weight - 6) * 0.8;
  context.font = `${fontWeight} ${state.fontSize}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = state.color;
  context.strokeStyle = state.color;
  context.lineWidth = strokeWidth;
  context.lineJoin = "round";
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
      if (strokeWidth > 0) {
        context.strokeText(char, 0, 0);
      }
      context.fillText(char, 0, 0);
      context.restore();
    }
    cursor += spacing;
    textIndex += 1;
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
  if (state.hands.length === 0) {
    pruneRopes(new Set());
    drawPrompt();
    return;
  }

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

function updateHands(landmarker, now) {
  const result = landmarker.detectForVideo(video, now);
  state.hands = (result.landmarks || []).map(analyzeHand);
}

function updateHandModeMask(segmenter, now) {
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
    if (state.display === "hand") {
      let mask = state.personMask;
      if (!state.segmenter) {
        ensureSegmenter().catch((error) => {
          console.error(error);
        });
      }
      if (video.currentTime !== state.lastVideoTime) {
        state.lastVideoTime = video.currentTime;
        updateHands(landmarker, now);
        if (state.segmenter) {
          mask = updateHandModeMask(state.segmenter, now);
        }
      }
      drawHandOnlyBackground(mask);
    } else {
      drawMirroredVideo();
      if (video.currentTime !== state.lastVideoTime) {
        state.lastVideoTime = video.currentTime;
        updateHands(landmarker, now);
      }
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
    shell.showLoading("正在開啟相機，請稍候…");
    resize();
    await setupCamera();
    visionFileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const landmarker = await HandLandmarker.createFromOptions(visionFileset, {
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
