import { FilesetResolver, FaceDetector } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "text-rope-link" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");
const textInput = document.createElement("input");

const nodeCount = 24;
const constraintIterations = 8;
const pairReleaseFactor = 1.12;
const anchorFollow = 0.62;
const anchorVelocityBlend = 0.65;
const anchorPrediction = 0.35;
const defaultText = "文字繩連連看";
const errorMessage =
  "請允許相機權限，並確認瀏覽器支援 getUserMedia。建議用 start.bat 啟動本機伺服器後再開啟效果。";

const state = {
  width: 1,
  height: 1,
  animationId: 0,
  lastVideoTime: -1,
  hasVideoFrame: false,
  nextPersonId: 1,
  people: [],
  ropes: new Map(),
  text: defaultText,
  fontSize: 26,
  spacing: 1,
  weight: 6,
  color: "#ffffff",
  maxDistPct: 55,
  gravity: 1.2,
  ropeLength: 0.45
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
textInput.placeholder = defaultText;
textInput.setAttribute("aria-label", "輸入要掛在線上的文字");
textInput.style.position = "absolute";
textInput.style.left = "50%";
textInput.style.top = "18px";
textInput.style.transform = "translateX(-50%)";
textInput.style.zIndex = "3";
textInput.style.width = "min(420px, calc(100vw - 36px))";
textInput.style.boxSizing = "border-box";
textInput.style.border = "1px solid rgba(255, 255, 255, 0.22)";
textInput.style.borderRadius = "8px";
textInput.style.padding = "11px 14px";
textInput.style.background = "rgba(0, 0, 0, 0.58)";
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
  label: "文字大小",
  min: 12,
  max: 48,
  step: 1,
  value: state.fontSize,
  onChange(value) {
    state.fontSize = value;
  }
});

shell.addParam({
  key: "spacing",
  type: "range",
  label: "文字疏密（越大越疏）",
  min: 0.5,
  max: 3,
  step: 0.05,
  value: state.spacing,
  onChange(value) {
    state.spacing = value;
  }
});

shell.addParam({
  key: "weight",
  type: "range",
  label: "文字粗細",
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
  label: "文字顏色",
  value: state.color,
  onChange(value) {
    state.color = value;
  }
});

shell.addParam({
  key: "maxDistPct",
  type: "range",
  label: "最遠連接距離",
  min: 15,
  max: 100,
  step: 5,
  value: state.maxDistPct,
  onChange(value) {
    state.maxDistPct = value;
  }
});

shell.addParam({
  key: "gravity",
  type: "range",
  label: "重力大小",
  min: 0.4,
  max: 3,
  step: 0.1,
  value: state.gravity,
  onChange(value) {
    state.gravity = value;
  }
});

shell.addParam({
  key: "ropeLength",
  type: "range",
  label: "文字繩長度（單人）",
  min: 0.2,
  max: 0.9,
  step: 0.05,
  value: state.ropeLength,
  onChange(value) {
    state.ropeLength = value;
  }
});

textInput.addEventListener("input", () => {
  state.text = textInput.value || textInput.placeholder;
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pairKey(a, b) {
  const minId = Math.min(a.id, b.id);
  const maxId = Math.max(a.id, b.id);
  return `pair-${minId}-${maxId}`;
}

function predictedPoint(person) {
  return {
    id: person.id,
    x: person.x + (person.vx || 0) * anchorPrediction,
    y: person.y + (person.vy || 0) * anchorPrediction,
    size: person.size,
    // 鼻尖與頭頂同屬一顆頭、移動一致，沿用同一組速度做預測，給單人繩當固定端。
    nose: {
      x: person.nx + (person.vx || 0) * anchorPrediction,
      y: person.ny + (person.vy || 0) * anchorPrediction
    }
  };
}

function resize() {
  state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
  state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
  canvas.width = Math.floor(state.width);
  canvas.height = Math.floor(state.height);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function drawMirroredVideo() {
  context.save();
  context.clearRect(0, 0, state.width, state.height);
  context.translate(state.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, state.width, state.height);
  context.restore();
}

function detectionToPerson(detection) {
  const bb = detection.boundingBox;
  const vw = video.videoWidth || state.width;
  const vh = video.videoHeight || state.height;
  const sx = state.width / vw;
  const sy = state.height / vh;
  const cx = bb.originX + bb.width / 2;
  // FaceDetector 的框大致涵蓋眉眼到下巴，框上緣偏眼睛高度；往上推約 0.55 個框高才接近頭頂（頭冠）。
  const headTopY = (bb.originY - bb.height * 0.55) * sy;

  // FaceDetector 第 3 個關鍵點是鼻尖（normalized 座標）；單人繩會黏在鼻子上。沒有關鍵點時退而用臉框中段。
  const noseKp = (detection.keypoints || [])[2];
  const noseX = noseKp ? state.width - noseKp.x * state.width : state.width - cx * sx;
  const noseY = noseKp
    ? clamp(noseKp.y * state.height, 0, state.height)
    : clamp((bb.originY + bb.height * 0.45) * sy, 0, state.height);

  return {
    x: state.width - cx * sx,
    y: clamp(headTopY, 0, state.height),
    noseX,
    noseY,
    size: Math.max(bb.width * sx, 24)
  };
}

function updatePeople(detections) {
  const matches = detections.map(detectionToPerson);
  const usedPeople = new Set();
  for (const person of state.people) {
    person.matched = false;
  }

  for (const match of matches) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const person of state.people) {
      if (usedPeople.has(person.id)) {
        continue;
      }
      const d = distance(person, match);
      const threshold = Math.max(match.size * 1.5, 140);
      if (d < threshold && d < nearestDistance) {
        nearest = person;
        nearestDistance = d;
      }
    }

    if (nearest) {
      const previousX = nearest.x;
      const previousY = nearest.y;
      const nextX = nearest.x + (match.x - nearest.x) * anchorFollow;
      const nextY = nearest.y + (match.y - nearest.y) * anchorFollow;
      // 頭頂點來自臉框推估，保留一點速度可減少慢半拍，同時仍壓住單幀抖動。
      nearest.vx = (nearest.vx || 0) * (1 - anchorVelocityBlend) + (nextX - previousX) * anchorVelocityBlend;
      nearest.vy = (nearest.vy || 0) * (1 - anchorVelocityBlend) + (nextY - previousY) * anchorVelocityBlend;
      nearest.x = nextX;
      nearest.y = nextY;
      nearest.nx += (match.noseX - nearest.nx) * anchorFollow;
      nearest.ny += (match.noseY - nearest.ny) * anchorFollow;
      nearest.size += (match.size - nearest.size) * 0.3;
      nearest.miss = 0;
      nearest.matched = true;
      usedPeople.add(nearest.id);
    } else {
      state.people.push({
        id: state.nextPersonId,
        x: match.x,
        y: match.y,
        nx: match.noseX,
        ny: match.noseY,
        vx: 0,
        vy: 0,
        size: match.size,
        miss: 0,
        matched: true
      });
      state.nextPersonId += 1;
    }
  }

  for (const person of state.people) {
    if (!person.matched) {
      person.x += (person.vx || 0) * 0.35;
      person.y += (person.vy || 0) * 0.35;
      person.nx += (person.vx || 0) * 0.35;
      person.ny += (person.vy || 0) * 0.35;
      person.vx = (person.vx || 0) * 0.72;
      person.vy = (person.vy || 0) * 0.72;
      person.miss += 1;
    }
  }

  state.people = state.people.filter((person) => person.miss <= 6);
  for (const person of state.people) {
    delete person.matched;
  }
}

function makeNode(x, y) {
  return { x, y, px: x, py: y, fixed: false };
}

// 與「玩弄文字於指尖」同一套作法：單端固定就整條往下自由垂掛、兩端固定就在中間留鬆弛弧度。
function makeRope(key, pins, totalLength) {
  const nodes = [];
  const restLength = totalLength / (nodeCount - 1);
  const start = pins[0].point;

  if (pins.length === 1) {
    for (let i = 0; i < nodeCount; i += 1) {
      // 初始往下排開，避免節點擠在固定點造成第一幀爆衝。
      const sway = Math.sin(i * 0.9 + key.length) * restLength * 0.18;
      nodes.push(makeNode(start.x + sway, start.y + i * restLength));
    }
  } else {
    const end = pins[pins.length - 1].point;
    for (let i = 0; i < nodeCount; i += 1) {
      const t = i / (nodeCount - 1);
      const x = start.x + (end.x - start.x) * t;
      // 初始略向下放，避免雙人繩剛出現時完全筆直。
      const y = start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * totalLength * 0.08;
      nodes.push(makeNode(x, y));
    }
  }

  return { key, nodes, restLength };
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

function updateRope(key, pins, totalLength) {
  let rope = state.ropes.get(key);
  if (!rope || Math.abs(rope.nodes.length * rope.restLength - totalLength) > state.height * 0.25) {
    rope = makeRope(key, pins, totalLength);
    state.ropes.set(key, rope);
  }

  rope.restLength = totalLength / (nodeCount - 1);
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

function drawCharAt(point, char, strokeWidth) {
  context.save();
  context.translate(point.x, point.y);
  context.rotate(point.angle);
  if (strokeWidth > 0) {
    context.strokeText(char, 0, 0);
  }
  context.fillText(char, 0, 0);
  context.restore();
}

function drawTextRope(rope) {
  const text = state.text.trim() || defaultText;
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
  context.shadowColor = "rgba(0, 0, 0, 0.56)";
  context.shadowBlur = 7;

  let textIndex = 0;
  let cursor = state.fontSize * 0.45;
  while (cursor < polyline.total) {
    const char = text[textIndex % text.length];
    const spacing = Math.max(state.fontSize * 0.55, context.measureText(char).width * state.spacing);
    const point = pointAtLength(polyline, cursor);
    if (point) {
      drawCharAt(point, char, strokeWidth);
    }
    cursor += spacing;
    textIndex += 1;
  }

  context.restore();
}

function drawPrompt() {
  const text = "站到鏡頭前，靠近朋友就會連成文字繩";
  const y = state.height - 58;
  context.save();
  context.font = "600 18px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = Math.min(state.width - 32, context.measureText(text).width + 42);
  context.fillStyle = "rgba(0, 0, 0, 0.56)";
  context.beginPath();
  context.roundRect((state.width - width) / 2, y - 22, width, 44, 22);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillText(text, state.width / 2, y, width - 24);
  context.restore();
}

// 單人繩固定在鼻子上，另一端自由垂下，靠鼻尖錨點移動與重力自然擺動。
function singleSpec(head) {
  return {
    key: `single-${head.id}`,
    pins: [{ index: 0, point: head.nose }],
    totalLength: state.height * state.ropeLength
  };
}

// 雙人繩：兩端各固定在一顆頭頂，受重力在中間自然下垂成弧（同「玩弄文字於指尖」雙手相連）。
function pairSpec(key, p1, p2) {
  return {
    key,
    pins: [
      { index: 0, point: p1 },
      { index: nodeCount - 1, point: p2 }
    ],
    totalLength: Math.max(distance(p1, p2) * 1.18, state.width * 0.12)
  };
}

function buildRopeSpecs() {
  const people = state.people.map(predictedPoint);
  const maxDist = (state.width * state.maxDistPct) / 100;
  const releaseDist = maxDist * pairReleaseFactor;

  if (people.length === 0) {
    return [];
  }

  if (people.length === 1) {
    return [singleSpec(people[0])];
  }

  const specs = [];
  const degree = new Map(people.map((person) => [person.id, 0]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const edgeKeys = new Set();

  function addPair(a, b) {
    const key = pairKey(a, b);
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    degree.set(a.id, degree.get(a.id) + 1);
    degree.set(b.id, degree.get(b.id) + 1);
    const left = a.id < b.id ? a : b;
    const right = a.id < b.id ? b : a;
    specs.push(pairSpec(key, left, right));
  }

  // 已存在的連線給一點斷開滯後，避免臉框單幀抖動讓 Verlet 狀態被重建。
  for (const key of state.ropes.keys()) {
    const match = /^pair-(\d+)-(\d+)$/.exec(key);
    if (!match) {
      continue;
    }
    const a = peopleById.get(Number(match[1]));
    const b = peopleById.get(Number(match[2]));
    if (a && b && distance(a, b) <= releaseDist) {
      addPair(a, b);
    }
  }

  // 每個人各自連到「離自己最近的另一個人」；已保留的舊連線優先，降低跳線。
  for (let i = 0; i < people.length; i += 1) {
    const a = people[i];
    if (degree.get(a.id) > 0) {
      continue;
    }
    let nearest = null;
    let nearestDistance = Infinity;
    for (let j = 0; j < people.length; j += 1) {
      if (j === i) {
        continue;
      }
      const d = distance(a, people[j]);
      if (d < nearestDistance) {
        nearest = people[j];
        nearestDistance = d;
      }
    }

    // 最近的人也超過門檻就不連，留待後面變成單人繩（即斷開反彈）。
    if (!nearest || nearestDistance > maxDist) {
      continue;
    }

    addPair(a, nearest);
  }

  for (const person of people) {
    if (degree.get(person.id) === 0) {
      specs.push(singleSpec(person));
    }
  }

  return specs;
}

function pruneRopes(activeKeys) {
  for (const key of state.ropes.keys()) {
    if (!activeKeys.has(key)) {
      state.ropes.delete(key);
    }
  }
}

function updateAndDrawRopes() {
  const specs = buildRopeSpecs();
  const activeKeys = new Set(specs.map((spec) => spec.key));
  pruneRopes(activeKeys);

  if (specs.length === 0) {
    drawPrompt();
    return;
  }

  for (const spec of specs) {
    const rope = updateRope(spec.key, spec.pins, spec.totalLength);
    drawTextRope(rope);
  }
}

function detectFaces(detector, now) {
  const result = detector.detectForVideo(video, now);
  updatePeople(result.detections || []);
}

function render(detector) {
  const now = performance.now();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (!state.hasVideoFrame) {
      state.hasVideoFrame = true;
      shell.hideLoading();
    }
    drawMirroredVideo();
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      detectFaces(detector, now);
    }
    updateAndDrawRopes();
  }
  state.animationId = window.requestAnimationFrame(() => render(detector));
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
  const stream = await Promise.race([request, timeout]);
  video.srcObject = stream;
  await video.play();
}

async function start() {
  try {
    shell.showLoading("正在啟動相機與人臉偵測...");
    resize();
    await setupCamera();
    const fileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const detector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/blaze_face_short_range.tflite" },
      runningMode: "VIDEO"
    });
    render(detector);
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
