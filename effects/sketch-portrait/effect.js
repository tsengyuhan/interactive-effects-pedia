import { FilesetResolver, ImageSegmenter } from "../../libs/mediapipe/vision_bundle.mjs";

// 草稿紙人像：webcam 經人像分割後，背景維持暖白稿紙；
// 人像平時以稿紙格內鉛筆塗黑呈現，拖曳撕縫時在縫內切換成連續素描濾鏡。

const shell = Shell.init({ id: "sketch-portrait" });
const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const video = document.createElement("video");

const paperCanvas = document.createElement("canvas");
const paperCtx = paperCanvas.getContext("2d");

const plainPaperCanvas = document.createElement("canvas");
const plainPaperCtx = plainPaperCanvas.getContext("2d");

const coarseCanvas = document.createElement("canvas");
const coarseCtx = coarseCanvas.getContext("2d");

const fineCanvas = document.createElement("canvas");
const fineCtx = fineCanvas.getContext("2d");

const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

const fineSampleCanvas = document.createElement("canvas");
const fineSampleCtx = fineSampleCanvas.getContext("2d", { willReadFrequently: true });

const finePixelCanvas = document.createElement("canvas");
const finePixelCtx = finePixelCanvas.getContext("2d", { willReadFrequently: true });

const HATCH_ANGLES = [Math.PI / 4, -Math.PI / 5, Math.PI / 2, 0, Math.PI / 9];
const MAX_LEVEL = HATCH_ANGLES.length;
const PAPER_COLOR = "#f1ecdd";
const GRID_COLOR = "rgba(70, 150, 90, 0.48)";
const PENCIL_COLOR = "rgba(35, 32, 26, 0.42)";
const STRIP = 2;

const state = {
  width: 1,
  height: 1,
  cell: 18,
  density: 1,
  band: 9,
  pitch: 27,
  cols: 1,
  rows: 1,
  cur: null,
  target: null,
  fineW: 1,
  fineH: 1,
  lastVideoTime: -1,
  hasVideoFrame: false,
  animationId: 0,
  seam: null,
  pressed: false,
  startX: 0,
  startY: 0,
  dragX: 0,
  dragY: 0
};

canvas.style.position = "absolute";
canvas.style.inset = "0";
canvas.style.width = "100%";
canvas.style.height = "100%";
canvas.style.display = "block";
canvas.style.cursor = "grab";
video.muted = true;
video.playsInline = true;
video.style.display = "none";
shell.container.style.overflow = "hidden";
shell.container.style.background = "#dcd6c4";
shell.container.append(video, canvas);

shell.addParam({
  type: "range",
  key: "cell",
  label: "格子大小",
  min: 10,
  max: 40,
  step: 1,
  value: state.cell,
  onChange(value) {
    state.cell = value;
    buildGrid();
  }
});

shell.addParam({
  type: "range",
  key: "density",
  label: "線條濃度",
  min: 50,
  max: 180,
  step: 5,
  value: 100,
  onChange(value) {
    state.density = value / 100;
  }
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// 縫內鉛筆毛邊：用 SVG 的 feTurbulence＋feDisplacementMap 依雜訊把線條像素推移，
// 做出石墨壓在粗紙上的不規則邊緣。固定 seed → 位移場在畫面上穩定，像紙的紋理。
const PENCIL_FILTER_ID = "sp-pencil-displace";
// 部分瀏覽器才支援 ctx.filter 引用 SVG filter（建議 Chrome / Edge）；不支援時退回無濾鏡
const SUPPORTS_CTX_FILTER = (() => {
  try {
    const probe = document.createElement("canvas").getContext("2d");
    return probe && "filter" in probe;
  } catch (error) {
    return false;
  }
})();

function injectPencilFilter() {
  if (!SUPPORTS_CTX_FILTER || document.getElementById(PENCIL_FILTER_ID)) {
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
    `<filter id="${PENCIL_FILTER_ID}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" result="noise"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;
  document.body.appendChild(svg);
}

function hashRandom(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function resize() {
  state.width = Math.max(1, Math.floor(shell.container.clientWidth || window.innerWidth));
  state.height = Math.max(1, Math.floor(shell.container.clientHeight || window.innerHeight));
  canvas.width = state.width;
  canvas.height = state.height;
  coarseCanvas.width = state.width;
  coarseCanvas.height = state.height;
  fineCanvas.width = state.width;
  fineCanvas.height = state.height;
  buildGrid();
}

function buildGrid() {
  state.band = Math.max(4, Math.round(state.cell * 0.5));
  state.pitch = state.cell + state.band;
  state.cols = Math.max(1, Math.ceil(state.width / state.cell));
  state.rows = Math.max(1, Math.ceil(state.height / state.pitch));
  const count = state.cols * state.rows;
  state.cur = new Float32Array(count);
  state.target = new Float32Array(count);
  sampleCanvas.width = state.cols;
  sampleCanvas.height = state.rows;
  buildFineBuffers();
  buildPaper();
}

function buildFineBuffers() {
  // 解析度拉高，縮放回畫面時線條更細更利落（不會糊成粗線）
  const maxW = 1080;
  const scale = Math.min(1, maxW / state.width);
  state.fineW = Math.max(1, Math.round(state.width * scale));
  state.fineH = Math.max(1, Math.round(state.height * scale));
  fineSampleCanvas.width = state.fineW;
  fineSampleCanvas.height = state.fineH;
  finePixelCanvas.width = state.fineW;
  finePixelCanvas.height = state.fineH;
}

function buildPaper() {
  paperCanvas.width = state.width;
  paperCanvas.height = state.height;
  plainPaperCanvas.width = state.width;
  plainPaperCanvas.height = state.height;
  const w = paperCanvas.width;
  const h = paperCanvas.height;

  paperCtx.fillStyle = PAPER_COLOR;
  paperCtx.fillRect(0, 0, w, h);

  const grains = Math.min(22000, Math.floor((w * h) / 80));
  for (let i = 0; i < grains; i += 1) {
    const gx = Math.random() * w;
    const gy = Math.random() * h;
    const dark = Math.random() < 0.55;
    paperCtx.fillStyle = dark ? "rgba(118, 108, 84, 0.045)" : "rgba(255, 255, 255, 0.065)";
    paperCtx.fillRect(gx, gy, 1.3, 1.3);
  }

  plainPaperCtx.clearRect(0, 0, w, h);
  plainPaperCtx.drawImage(paperCanvas, 0, 0);

  paperCtx.strokeStyle = GRID_COLOR;
  paperCtx.lineWidth = 1;
  for (let row = 0; row < state.rows; row += 1) {
    const y0 = Math.round(row * state.pitch) + 0.5;
    const y1 = Math.round(row * state.pitch + state.cell) + 0.5;
    paperCtx.beginPath();
    paperCtx.moveTo(0, y0);
    paperCtx.lineTo(w, y0);
    paperCtx.moveTo(0, y1);
    paperCtx.lineTo(w, y1);
    for (let col = 0; col <= state.cols; col += 1) {
      const x = Math.round(col * state.cell) + 0.5;
      paperCtx.moveTo(x, y0);
      paperCtx.lineTo(x, y1);
    }
    paperCtx.stroke();
  }

  paperCtx.strokeStyle = "rgba(196, 92, 78, 0.36)";
  paperCtx.lineWidth = 1.5;
  paperCtx.beginPath();
  const margin = Math.round(state.cell * 1.5) + 0.5;
  paperCtx.moveTo(margin, 0);
  paperCtx.lineTo(margin, h);
  paperCtx.stroke();
}

function readMask(result) {
  if (!result || !result.confidenceMasks || !result.confidenceMasks[0]) {
    return null;
  }
  const mp = result.confidenceMasks[0];
  return {
    width: mp.width,
    height: mp.height,
    data: mp.getAsFloat32Array()
  };
}

function mirroredMaskAt(mask, nx, ny) {
  if (!mask) {
    return 1;
  }
  const mx = clamp(Math.floor((1 - nx) * mask.width), 0, mask.width - 1);
  const my = clamp(Math.floor(ny * mask.height), 0, mask.height - 1);
  return mask.data[my * mask.width + mx];
}

function updateTargets(segmenter, now) {
  sampleCtx.save();
  sampleCtx.translate(state.cols, 0);
  sampleCtx.scale(-1, 1);
  sampleCtx.drawImage(video, 0, 0, state.cols, state.rows);
  sampleCtx.restore();
  const pixels = sampleCtx.getImageData(0, 0, state.cols, state.rows).data;

  const result = segmenter.segmentForVideo(video, now);
  const mask = readMask(result);

  for (let row = 0; row < state.rows; row += 1) {
    const y = row * state.pitch + state.cell * 0.5;
    for (let col = 0; col < state.cols; col += 1) {
      const idx = row * state.cols + col;
      const p = idx * 4;
      const lum = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;
      const x = col * state.cell + state.cell * 0.5;
      const conf = mirroredMaskAt(mask, x / state.width, y / state.height);
      const coverage = clamp((conf - 0.38) / 0.42, 0, 1);
      const shade = coverage * (0.16 + 0.84 * (1 - lum)) * state.density;
      state.target[idx] = clamp(shade, 0, 1);
    }
  }

  updateFineSketch(mask);

  if (result && typeof result.close === "function") {
    result.close();
  }
}

function updateFineSketch(mask) {
  fineCtx.setTransform(1, 0, 0, 1, 0, 0);
  fineCtx.clearRect(0, 0, state.width, state.height);
  // 縫內底＝同一張純紙底（PAPER_COLOR＋紙紋），與外面稿紙完全一致
  fineCtx.drawImage(plainPaperCanvas, 0, 0);

  fineSampleCtx.save();
  fineSampleCtx.translate(state.fineW, 0);
  fineSampleCtx.scale(-1, 1);
  fineSampleCtx.drawImage(video, 0, 0, state.fineW, state.fineH);
  fineSampleCtx.restore();

  const source = fineSampleCtx.getImageData(0, 0, state.fineW, state.fineH);
  const data = source.data;
  const out = finePixelCtx.createImageData(state.fineW, state.fineH);
  const dst = out.data;
  const lum = new Float32Array(state.fineW * state.fineH);
  const smooth = new Float32Array(state.fineW * state.fineH);
  const cover = new Float32Array(state.fineW * state.fineH);

  for (let y = 0; y < state.fineH; y += 1) {
    for (let x = 0; x < state.fineW; x += 1) {
      const idx = y * state.fineW + x;
      const p = idx * 4;
      lum[idx] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
      cover[idx] = clamp((mirroredMaskAt(mask, (x + 0.5) / state.fineW, (y + 0.5) / state.fineH) - 0.34) / 0.42, 0, 1);
    }
  }

  for (let y = 0; y < state.fineH; y += 1) {
    for (let x = 0; x < state.fineW; x += 1) {
      let sum = 0;
      let weight = 0;

      for (let oy = -1; oy <= 1; oy += 1) {
        const yy = clamp(y + oy, 0, state.fineH - 1);
        for (let ox = -1; ox <= 1; ox += 1) {
          const xx = clamp(x + ox, 0, state.fineW - 1);
          const w = (ox === 0 && oy === 0) ? 4 : ((ox === 0 || oy === 0) ? 2 : 1);
          sum += lum[yy * state.fineW + xx] * w;
          weight += w;
        }
      }

      smooth[y * state.fineW + x] = sum / weight;
    }
  }

  for (let y = 0; y < state.fineH; y += 1) {
    for (let x = 0; x < state.fineW; x += 1) {
      const idx = y * state.fineW + x;
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(state.fineW - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(state.fineH - 1, y + 1);
      const tl = smooth[y0 * state.fineW + x0];
      const tc = smooth[y0 * state.fineW + x];
      const tr = smooth[y0 * state.fineW + x1];
      const ml = smooth[y * state.fineW + x0];
      const mr = smooth[y * state.fineW + x1];
      const bl = smooth[y1 * state.fineW + x0];
      const bc = smooth[y1 * state.fineW + x];
      const br = smooth[y1 * state.fineW + x1];
      const gx = -tl - ml * 2 - bl + tr + mr * 2 + br;
      const gy = -tl - tc * 2 - tr + bl + bc * 2 + br;
      // 門檻起點調低：弱邊緣（細紋/髮絲/五官）也畫成淡細線 → 細節更多；
      // 高解析度維持線細、弱邊緣自然只給低 alpha，所以不會更粗更黑
      const imageEdge = smoothstep(0.04, 0.60, Math.sqrt(gx * gx + gy * gy));
      // 外框做淡：門檻提高並只給半強度，輪廓不再死黑
      const maskEdge = smoothstep(0.08, 0.34, Math.max(
        Math.abs(cover[idx] - cover[y * state.fineW + x0]),
        Math.abs(cover[idx] - cover[y * state.fineW + x1]),
        Math.abs(cover[idx] - cover[y0 * state.fineW + x]),
        Math.abs(cover[idx] - cover[y1 * state.fineW + x])
      )) * 0.45;
      const grain = 0.9 + hashRandom(idx * 0.77) * 0.16;
      const line = clamp(Math.max(imageEdge, maskEdge) * cover[idx] * grain, 0, 1);
      const p = idx * 4;
      dst[p] = 48;
      dst[p + 1] = 45;
      dst[p + 2] = 39;
      // 整體調淡：細節變多但每條更輕，避免整體變黑
      dst[p + 3] = Math.round(line * 150);
    }
  }

  finePixelCtx.putImageData(out, 0, 0);
  fineCtx.save();
  fineCtx.imageSmoothingEnabled = true;
  // 只對線條圖層套位移濾鏡（紙底已先畫好、不受影響），讓邊緣變鉛筆毛邊
  if (SUPPORTS_CTX_FILTER) {
    fineCtx.filter = `url(#${PENCIL_FILTER_ID})`;
  }
  fineCtx.drawImage(finePixelCanvas, 0, 0, state.width, state.height);
  fineCtx.restore();
}

function addPencilStroke(ctx, x1, y1, x2, y2, seed) {
  const steps = 3;
  ctx.moveTo(x1, y1);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const wobble = (hashRandom(seed + i * 9.1) - 0.5) * 1.6;
    const px = x1 + (x2 - x1) * t + wobble;
    const py = y1 + (y2 - y1) * t + (hashRandom(seed + i * 11.7) - 0.5) * 1.6;
    ctx.lineTo(px, py);
  }
}

function clippedLineInRect(cx, cy, dirX, dirY, minX, minY, maxX, maxY) {
  let tMin = -Infinity;
  let tMax = Infinity;
  if (Math.abs(dirX) > 0.0001) {
    const tx1 = (minX - cx) / dirX;
    const tx2 = (maxX - cx) / dirX;
    tMin = Math.max(tMin, Math.min(tx1, tx2));
    tMax = Math.min(tMax, Math.max(tx1, tx2));
  } else if (cx < minX || cx > maxX) {
    return null;
  }
  if (Math.abs(dirY) > 0.0001) {
    const ty1 = (minY - cy) / dirY;
    const ty2 = (maxY - cy) / dirY;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));
  } else if (cy < minY || cy > maxY) {
    return null;
  }
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMin >= tMax) {
    return null;
  }
  return {
    x1: cx + dirX * tMin,
    y1: cy + dirY * tMin,
    x2: cx + dirX * tMax,
    y2: cy + dirY * tMax
  };
}

function addHatch(ctx, x, y, size, angle, seed, strength) {
  const margin = Math.max(2, size * 0.12);
  const minX = x + margin;
  const minY = y + margin;
  const maxX = x + size - margin;
  const maxY = y + size - margin;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;
  const count = 2 + Math.floor(hashRandom(seed + 0.3) * 3 + strength * 2);
  const span = (size - margin * 2) * 0.82;

  for (let k = 0; k < count; k += 1) {
    const t = count === 1 ? 0.5 : k / (count - 1);
    const jitter = (hashRandom(seed + k * 17.3) - 0.5) * size * 0.2;
    const offset = (t - 0.5) * span + jitter;
    const cx = x + size / 2 + perpX * offset + (hashRandom(seed + k * 7.1) - 0.5) * 1.8;
    const cy = y + size / 2 + perpY * offset + (hashRandom(seed + k * 8.9) - 0.5) * 1.8;
    const line = clippedLineInRect(cx, cy, dirX, dirY, minX, minY, maxX, maxY);
    if (line) {
      addPencilStroke(ctx, line.x1, line.y1, line.x2, line.y2, seed + k * 5.31);
    }
  }
}

function smoothDarkness() {
  const cur = state.cur;
  const target = state.target;
  for (let i = 0; i < cur.length; i += 1) {
    cur[i] += (target[i] - cur[i]) * 0.35;
  }
}

function drawCoarseSketch() {
  coarseCtx.setTransform(1, 0, 0, 1, 0, 0);
  coarseCtx.clearRect(0, 0, state.width, state.height);
  coarseCtx.drawImage(paperCanvas, 0, 0);

  coarseCtx.strokeStyle = PENCIL_COLOR;
  coarseCtx.lineWidth = 0.9;
  coarseCtx.lineCap = "round";
  coarseCtx.lineJoin = "round";

  for (let layer = 0; layer < MAX_LEVEL; layer += 1) {
    coarseCtx.beginPath();
    let any = false;
    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const idx = row * state.cols + col;
        const strength = state.cur[idx];
        const threshold = (layer + 0.35 + hashRandom(idx * 2.3 + layer * 19.7) * 0.35) / MAX_LEVEL;
        if (strength > threshold) {
          const angleJitter = (hashRandom(idx * 4.1 + layer * 3.9) - 0.5) * 0.28;
          addHatch(
            coarseCtx,
            col * state.cell,
            row * state.pitch,
            state.cell,
            HATCH_ANGLES[layer] + angleJitter,
            idx * 11.7 + layer * 29.3,
            strength
          );
          any = true;
        }
      }
    }
    if (any) {
      coarseCtx.stroke();
    }
  }
}

function raisedCosine(distance, radius) {
  if (radius <= 0 || distance >= radius) {
    return 0;
  }
  return 0.5 + 0.5 * Math.cos(Math.PI * distance / radius);
}

function seamBump(seam, along) {
  const radius = seam.radius;
  const center = seam.orient === "v" ? seam.dragY : seam.dragX;
  return seam.gap * raisedCosine(Math.abs(along - center), radius);
}

function composite() {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, state.width, state.height);

  const seam = state.seam;
  if (!seam || seam.gap < 0.8) {
    context.drawImage(coarseCanvas, 0, 0);
    return;
  }

  if (seam.orient === "h") {
    compositeHorizontal(seam);
  } else {
    compositeVertical(seam);
  }
}

function compositeHorizontal(seam) {
  const seamY = clamp(seam.pos, 0, state.height);
  for (let x = 0; x < state.width; x += STRIP) {
    const w = Math.min(STRIP, state.width - x);
    const bump = seamBump(seam, x);
    const half = bump / 2;
    if (seamY > 0) {
      context.drawImage(coarseCanvas, x, 0, w, seamY, x, -half, w, seamY);
    }
    if (state.height - seamY > 0) {
      context.drawImage(coarseCanvas, x, seamY, w, state.height - seamY, x, seamY + half, w, state.height - seamY);
    }
    if (bump > 0.5) {
      const sy = clamp(seamY - half, 0, state.height);
      const ey = clamp(seamY + half, 0, state.height);
      if (ey > sy) {
        context.drawImage(fineCanvas, x, sy, w, ey - sy, x, sy, w, ey - sy);
      }
    }
  }
  paintVariableSeamShadow(seam, false);
}

function compositeVertical(seam) {
  const seamX = clamp(seam.pos, 0, state.width);
  for (let y = 0; y < state.height; y += STRIP) {
    const h = Math.min(STRIP, state.height - y);
    const bump = seamBump(seam, y);
    const half = bump / 2;
    if (seamX > 0) {
      context.drawImage(coarseCanvas, 0, y, seamX, h, -half, y, seamX, h);
    }
    if (state.width - seamX > 0) {
      context.drawImage(coarseCanvas, seamX, y, state.width - seamX, h, seamX + half, y, state.width - seamX, h);
    }
    if (bump > 0.5) {
      const sx = clamp(seamX - half, 0, state.width);
      const ex = clamp(seamX + half, 0, state.width);
      if (ex > sx) {
        context.drawImage(fineCanvas, sx, y, ex - sx, h, sx, y, ex - sx, h);
      }
    }
  }
  paintVariableSeamShadow(seam, true);
}

function paintVariableSeamShadow(seam, vertical) {
  context.save();
  context.strokeStyle = "rgba(34, 28, 18, 0.20)";
  context.lineWidth = 1.2;
  context.beginPath();
  if (vertical) {
    const x = seam.pos;
    for (let y = 0; y <= state.height; y += STRIP) {
      const half = seamBump(seam, y) / 2;
      context.moveTo(x - half, y);
      context.lineTo(x - half - 0.01, y + STRIP);
      context.moveTo(x + half, y);
      context.lineTo(x + half + 0.01, y + STRIP);
    }
  } else {
    const y = seam.pos;
    for (let x = 0; x <= state.width; x += STRIP) {
      const half = seamBump(seam, x) / 2;
      context.moveTo(x, y - half);
      context.lineTo(x + STRIP, y - half - 0.01);
      context.moveTo(x, y + half);
      context.lineTo(x + STRIP, y + half + 0.01);
    }
  }
  context.stroke();
  context.restore();
}

function updateSeam() {
  const seam = state.seam;
  if (!seam) {
    return;
  }
  if (!state.pressed) {
    seam.gap *= 0.82;
    if (seam.gap < 0.8) {
      state.seam = null;
    }
  }
}

function render(segmenter) {
  const now = performance.now();
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (!state.hasVideoFrame) {
      state.hasVideoFrame = true;
      shell.hideLoading();
    }
    if (video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = video.currentTime;
      updateTargets(segmenter, now);
    }
    smoothDarkness();
    drawCoarseSketch();
    updateSeam();
    composite();
  }
  state.animationId = window.requestAnimationFrame(() => render(segmenter));
}

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (state.width / rect.width),
    y: (event.clientY - rect.top) * (state.height / rect.height)
  };
}

canvas.addEventListener("pointerdown", (event) => {
  const pos = pointerPos(event);
  state.pressed = true;
  state.startX = pos.x;
  state.startY = pos.y;
  state.dragX = pos.x;
  state.dragY = pos.y;
  state.seam = null;
  canvas.style.cursor = "grabbing";
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.pressed) {
    return;
  }
  const pos = pointerPos(event);
  state.dragX = pos.x;
  state.dragY = pos.y;
  const dx = pos.x - state.startX;
  const dy = pos.y - state.startY;
  if (!state.seam) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) {
      return;
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      const seamX = clamp(Math.round(state.startX / state.cell) * state.cell, 0, state.width);
      state.seam = { orient: "v", pos: seamX, gap: 0, radius: Math.max(120, state.height * 0.42), dragX: pos.x, dragY: pos.y };
    } else {
      const seamY = clamp(Math.round(state.startY / state.pitch) * state.pitch, 0, state.height);
      state.seam = { orient: "h", pos: seamY, gap: 0, radius: Math.max(120, state.width * 0.42), dragX: pos.x, dragY: pos.y };
    }
  }

  state.seam.dragX = pos.x;
  state.seam.dragY = pos.y;
  if (state.seam.orient === "v") {
    state.seam.gap = clamp(Math.abs(dx) * 1.55, 0, Math.min(state.width * 0.68, 180));
  } else {
    state.seam.gap = clamp(Math.abs(dy) * 1.55, 0, Math.min(state.height * 0.68, 180));
  }
});

function endPress() {
  state.pressed = false;
  canvas.style.cursor = "grab";
}
canvas.addEventListener("pointerup", endPress);
canvas.addEventListener("pointercancel", endPress);

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
    shell.showLoading("正在開啟相機並載入人像模型，請稍候…");
    injectPencilFilter();
    resize();
    await setupCamera();
    const fileset = await FilesetResolver.forVisionTasks("../../libs/mediapipe/wasm");
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "../../libs/mediapipe/selfie_segmenter.tflite" },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true
    });
    render(segmenter);
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
