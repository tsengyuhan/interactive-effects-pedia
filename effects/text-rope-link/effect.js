import { FilesetResolver, FaceDetector } from "../../libs/mediapipe/vision_bundle.mjs";

const shell = Shell.init({ id: "text-rope-link" });
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");
const textInput = document.createElement("input");

const nodeCount = 24;
const constraintIterations = 8;
const archSamples = 40;
// 軟錨點拉力：每幀把錨點節點往「無形點」輕拉一次（非硬釘），保留 text-ropes 般的柔軟與晃動。
const anchorPull = 0.35;
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
  ropeLength: 0.45,
  anchorHeight: 55,
  archHeightFactor: 0.45,
  flowSpeed: 0.03
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

shell.addParam({
  key: "anchorHeight",
  type: "range",
  label: "無形錨點高度（單人）",
  min: 0,
  max: 200,
  step: 5,
  value: state.anchorHeight,
  onChange(value) {
    state.anchorHeight = value;
  }
});

shell.addParam({
  key: "archHeightFactor",
  type: "range",
  label: "拱起高度（雙人）",
  min: 0.1,
  max: 1,
  step: 0.05,
  value: state.archHeightFactor,
  onChange(value) {
    state.archHeightFactor = value;
  }
});

shell.addParam({
  key: "flowSpeed",
  type: "range",
  label: "文字流動速度（雙人）",
  min: 0,
  max: 0.12,
  step: 0.005,
  value: state.flowSpeed,
  onChange(value) {
    state.flowSpeed = value;
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

  return {
    x: state.width - cx * sx,
    y: clamp(headTopY, 0, state.height),
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
      nearest.x += (match.x - nearest.x) * 0.4;
      nearest.y += (match.y - nearest.y) * 0.4;
      nearest.size += (match.size - nearest.size) * 0.3;
      nearest.miss = 0;
      nearest.matched = true;
      usedPeople.add(nearest.id);
    } else {
      state.people.push({
        id: state.nextPersonId,
        x: match.x,
        y: match.y,
        size: match.size,
        miss: 0,
        matched: true
      });
      state.nextPersonId += 1;
    }
  }

  for (const person of state.people) {
    if (!person.matched) {
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

// 單人文字繩總長度（含往上一段＋垂下段），由「文字繩長度」參數控制。
function singleRopeLength() {
  return state.height * state.ropeLength;
}

// 頭頂上方那個「無形的點」離頭頂的距離，由參數控制；但不超過總長一半，確保還有垂下段。
function singleUpRise(totalLength) {
  return Math.min(state.anchorHeight, totalLength * 0.5);
}

// 單人繩：node0 釘在頭頂，anchorIndex 那個節點釘在頭頂上方的無形點，
// 兩釘點間是往上的繃直段，之後的節點自然垂下並隨頭部移動晃動。
function makeSingleRope(key, head) {
  const totalLength = singleRopeLength();
  const restLength = totalLength / (nodeCount - 1);
  const upRise = singleUpRise(totalLength);
  const anchorIndex = clamp(Math.round(upRise / restLength), 1, nodeCount - 2);
  const anchor = { x: head.x, y: head.y - upRise };
  const nodes = [];
  for (let i = 0; i < nodeCount; i += 1) {
    if (i <= anchorIndex) {
      const t = anchorIndex === 0 ? 0 : i / anchorIndex;
      nodes.push(makeNode(head.x + (anchor.x - head.x) * t, head.y + (anchor.y - head.y) * t));
    } else {
      nodes.push(makeNode(anchor.x, anchor.y + (i - anchorIndex) * restLength));
    }
  }
  return { type: "single", key, nodes, restLength, anchorIndex };
}

// 雙人繩：移除重力，改用固定的「往上拱起」二次貝茲曲線取樣，兩端釘在兩顆頭頂。
function buildArchNodes(p1, p2) {
  const d = distance(p1, p2);
  const archHeight = clamp(d * state.archHeightFactor, 36, 600);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const controlX = midX;
  const controlY = midY - archHeight;
  const nodes = [];
  for (let i = 0; i < archSamples; i += 1) {
    const t = i / (archSamples - 1);
    const mt = 1 - t;
    const x = mt * mt * p1.x + 2 * mt * t * controlX + t * t * p2.x;
    const y = mt * mt * p1.y + 2 * mt * t * controlY + t * t * p2.y;
    nodes.push({ x, y });
  }
  return nodes;
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

function updateSingleRope(key, head) {
  const totalLength = singleRopeLength();
  let rope = state.ropes.get(key);
  if (
    !rope ||
    rope.type !== "single" ||
    Math.abs(rope.nodes.length * rope.restLength - totalLength) > state.height * 0.25
  ) {
    rope = makeSingleRope(key, head);
    state.ropes.set(key, rope);
  }

  const restLength = totalLength / (nodeCount - 1);
  const upRise = singleUpRise(totalLength);
  const anchorIndex = clamp(Math.round(upRise / restLength), 1, nodeCount - 2);
  rope.restLength = restLength;
  rope.anchorIndex = anchorIndex;
  for (const node of rope.nodes) {
    node.fixed = false;
  }
  // 只硬釘頭頂這一端；錨點改成軟拉，整條繩維持柔軟、能晃動（仿 text-ropes 單手繩）。
  setFixedNode(rope.nodes[0], head);

  integrate(rope);
  const anchorNode = rope.nodes[anchorIndex];
  anchorNode.x += (head.x - anchorNode.x) * anchorPull;
  anchorNode.y += (head.y - upRise - anchorNode.y) * anchorPull;
  satisfyConstraints(rope);
  return rope;
}

function updatePairRope(key, p1, p2) {
  let rope = state.ropes.get(key);
  if (!rope || rope.type !== "pair") {
    // 連線剛形成：隨機決定文字流動方向（+1 / -1），之後持續同向流動。
    rope = { type: "pair", key, flow: 0, direction: Math.random() < 0.5 ? 1 : -1 };
    state.ropes.set(key, rope);
  }
  rope.nodes = buildArchNodes(p1, p2);
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

// flowing 為 true（雙人繩）時：整串文字以固定間距沿弧長隨時間平移，呈現「文字流動」。
function drawTextRope(rope, flowing) {
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

  if (flowing) {
    // 流動繩用固定間距（中文字寬約等於字高），讓整串等距平移看起來連續。
    const sample = context.measureText(text[0] || "字").width;
    const spacing = Math.max(state.fontSize * 0.55, sample * state.spacing);
    rope.flow += spacing * state.flowSpeed * rope.direction;
    const len = text.length;
    const jMin = Math.ceil(rope.flow / spacing);
    const jMax = Math.floor((rope.flow + polyline.total) / spacing);
    for (let j = jMin; j <= jMax; j += 1) {
      const point = pointAtLength(polyline, j * spacing - rope.flow);
      if (point) {
        drawCharAt(point, text[((j % len) + len) % len], strokeWidth);
      }
    }
  } else {
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

function buildRopeSpecs() {
  const people = state.people;
  const maxDist = (state.width * state.maxDistPct) / 100;

  if (people.length === 0) {
    return [];
  }

  if (people.length === 1) {
    const person = people[0];
    return [{ kind: "single", key: `single-${person.id}`, head: person }];
  }

  const specs = [];
  const degree = new Map(people.map((person) => [person.id, 0]));
  const edgeKeys = new Set();
  // 每個人各自連到「離自己最近的另一個人」：互為最近時兩邊會產生同一條邊，用 edgeKeys 去重只畫一條。
  for (let i = 0; i < people.length; i += 1) {
    const a = people[i];
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

    // 兩端都標記為已連上；互為最近時兩次迴圈都會跑到，degree 一律 >0。
    degree.set(a.id, degree.get(a.id) + 1);
    degree.set(nearest.id, degree.get(nearest.id) + 1);

    const minId = Math.min(a.id, nearest.id);
    const maxId = Math.max(a.id, nearest.id);
    const key = `pair-${minId}-${maxId}`;
    if (edgeKeys.has(key)) {
      continue;
    }
    edgeKeys.add(key);

    const left = a.id === minId ? a : nearest;
    const right = a.id === minId ? nearest : a;
    specs.push({ kind: "pair", key, p1: left, p2: right });
  }

  for (const person of people) {
    if (degree.get(person.id) === 0) {
      specs.push({ kind: "single", key: `single-${person.id}`, head: person });
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
    if (spec.kind === "single") {
      drawTextRope(updateSingleRope(spec.key, spec.head), false);
    } else {
      drawTextRope(updatePairRope(spec.key, spec.p1, spec.p2), true);
    }
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
