(function () {
  "use strict";

  const shell = Shell.init({ id: "ink-brush" });
  const paperCanvas = document.createElement("canvas");
  const inkCanvas = document.createElement("canvas");
  // 當前筆畫獨立一層：每幀把「整條」路徑重畫一次，避免一段段描邊在接點處
  // 用 multiply 疊出念珠狀顆粒；收筆才整條疊進墨層。
  const strokeCanvas = document.createElement("canvas");
  const inputCanvas = document.createElement("canvas");
  const paperContext = paperCanvas.getContext("2d");
  const inkContext = inkCanvas.getContext("2d");
  const strokeContext = strokeCanvas.getContext("2d");
  const inputContext = inputCanvas.getContext("2d");

  const state = {
    density: 0.6,
    bleed: 0.5,
    size: 24,
    ink: "#1a1a1a"
  };
  const pointer = {
    active: false,
    id: null,
    x: 0,
    y: 0,
    time: 0,
    stillFrames: 0,
    points: []
  };
  const bleeds = [];

  let width = 1;
  let height = 1;
  let ratio = 1;
  let animationId = 0;
  let strokeDirty = false;

  for (const canvas of [paperCanvas, inkCanvas, strokeCanvas, inputCanvas]) {
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
  }

  paperCanvas.style.zIndex = "0";
  inkCanvas.style.zIndex = "1";
  strokeCanvas.style.zIndex = "1";
  strokeCanvas.style.pointerEvents = "none";
  // 濃度＝整條筆畫圖層的不透明度：低濃度真的淡、且 0→1 範圍均勻；
  // 墨點本身的濃淡留給運筆速度決定，才有不平均的墨韻
  strokeCanvas.style.opacity = String(state.density);
  inputCanvas.style.zIndex = "2";
  inputCanvas.style.touchAction = "none";
  inputContext.canvas.setAttribute("aria-label", "水墨筆觸畫布");

  shell.container.style.overflow = "hidden";
  shell.container.append(paperCanvas, inkCanvas, strokeCanvas, inputCanvas);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hexToRgb(hex) {
    const normalized = hex.replace("#", "").trim();
    const value = normalized.length === 3
      ? normalized.split("").map((char) => char + char).join("")
      : normalized;
    const number = Number.parseInt(value, 16);
    if (Number.isNaN(number)) {
      return { r: 26, g: 26, b: 26 };
    }
    return {
      r: (number >> 16) & 255,
      g: (number >> 8) & 255,
      b: number & 255
    };
  }

  function rgba(alpha) {
    const color = hexToRgb(state.ink);
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
  }

  function prepareCanvas(canvas, context) {
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function drawPaper() {
    paperContext.clearRect(0, 0, width, height);
    paperContext.fillStyle = "#efe8d2";
    paperContext.fillRect(0, 0, width, height);

    const image = paperContext.getImageData(0, 0, paperCanvas.width, paperCanvas.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const noise = Math.floor((Math.random() - 0.5) * 16);
      data[index] = clamp(data[index] + noise, 0, 255);
      data[index + 1] = clamp(data[index + 1] + noise, 0, 255);
      data[index + 2] = clamp(data[index + 2] + noise, 0, 255);
      data[index + 3] = 255;
    }
    paperContext.putImageData(image, 0, 0);

    paperContext.save();
    paperContext.setTransform(1, 0, 0, 1, 0, 0);
    paperContext.scale(ratio, ratio);
    paperContext.lineCap = "round";
    for (let i = 0; i < 360; i += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const length = 18 + Math.random() * 72;
      const curve = (Math.random() - 0.5) * 18;
      const alpha = 0.025 + Math.random() * 0.045;
      paperContext.beginPath();
      paperContext.moveTo(x, y);
      paperContext.quadraticCurveTo(x + length * 0.5, y + curve, x + length, y + curve * 0.35);
      paperContext.strokeStyle = `rgba(118, 96, 57, ${alpha})`;
      paperContext.lineWidth = 0.4 + Math.random() * 0.9;
      paperContext.stroke();
    }
    paperContext.restore();
  }

  function clearStrokeLayer() {
    strokeContext.clearRect(0, 0, width, height);
  }

  function clearInk() {
    bleeds.length = 0;
    pointer.points = [];
    strokeDirty = false;
    inkContext.clearRect(0, 0, width, height);
    clearStrokeLayer();
  }

  function resize() {
    ratio = window.devicePixelRatio || 1;
    width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    prepareCanvas(paperCanvas, paperContext);
    prepareCanvas(inkCanvas, inkContext);
    prepareCanvas(strokeCanvas, strokeContext);
    prepareCanvas(inputCanvas, inputContext);
    drawPaper();
    // 尺寸改變時舊墨跡比例難以準確保留，清除可避免變形。
    clearInk();
  }

  function addBleed(x, y, strength) {
    const lobeCount = 3 + Math.floor(Math.random() * 3);
    const lobes = [];
    for (let i = 0; i < lobeCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = state.size * (0.06 + Math.random() * 0.16);
      lobes.push({
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        r: 0.78 + Math.random() * 0.54,
        grow: 0.74 + Math.random() * 0.58,
        alpha: 0.72 + Math.random() * 0.42
      });
    }
    bleeds.push({
      x,
      y,
      // 起始半徑也隨暈染參數放大，讓低/高暈染差異更明顯
      r: state.size * (0.3 + state.bleed * 0.45 + Math.random() * 0.15),
      alpha: state.density * strength * 0.12,
      lobes
    });
  }

  // 沿路徑蓋一顆柔邊墨點：中心濃、邊緣平滑淡出（這是原始版的水墨柔邊質感來源）
  function stampSoft(ctx, x, y, radius, alpha) {
    const color = hexToRgb(state.ink);
    const a = clamp(alpha, 0, 1);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    // 中央保留一段實心平台讓墨色夠濃，再向外平滑羽化成柔邊（避免太淡或硬邊灰軌）
    gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`);
    gradient.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`);
    gradient.addColorStop(0.78, `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(a * 0.42, 0, 1)})`);
    gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 把整條 pointer.points 沿路徑蓋密集柔邊墨點：每幀整條重畫，
  // 重疊的柔邊互相累積成連貫且中央濃、邊緣自然暈散的筆跡（不會有黑芯+兩條灰軌、也無顆粒）。
  // 依運筆速度產生一個取樣點：慢筆濃而粗、快筆淡而細，
  // 並加一點建立時就固定的隨機抖動，讓墨色沿線不平均（每幀重畫不會閃爍）。
  function strokePoint(x, y, speed) {
    const fast = clamp((speed - 0.3) / 1.2, 0, 1);
    const jitter = 0.82 + Math.random() * 0.36;
    return {
      x,
      y,
      a: clamp(lerp(0.2, 0.075, fast) * jitter, 0, 1),
      r: state.size * 0.5 * lerp(1, 0.62, fast)
    };
  }

  // 每個取樣點自帶 a（柔邊墨點 alpha）與 r（半徑），由運筆速度決定：
  // 慢筆濃而粗、快筆淡而細，沿線插值後疊出濃淡不均的墨韻（不再像均勻畫筆）。
  // 不在這裡乘濃度——濃度由 strokeCanvas 圖層不透明度統一控制。
  function drawActiveStroke() {
    clearStrokeLayer();
    const pts = pointer.points;
    if (pts.length === 0) {
      return;
    }

    if (pts.length === 1) {
      stampSoft(strokeContext, pts[0].x, pts[0].y, pts[0].r, clamp(pts[0].a * 1.6, 0, 1));
      return;
    }

    let prev = pts[0];
    stampSoft(strokeContext, prev.x, prev.y, prev.r, prev.a);
    for (let i = 1; i < pts.length; i += 1) {
      const point = pts[i];
      const dx = point.x - prev.x;
      const dy = point.y - prev.y;
      const distance = Math.hypot(dx, dy);
      const avgRadius = (prev.r + point.r) * 0.5;
      // 相鄰取樣點之間補插，墨點間距約半徑的 1/4，疊出來才平滑連續
      const sub = Math.max(1, Math.ceil(distance / Math.max(1, avgRadius * 0.25)));
      for (let s = 1; s <= sub; s += 1) {
        const t = s / sub;
        stampSoft(
          strokeContext,
          prev.x + dx * t,
          prev.y + dy * t,
          lerp(prev.r, point.r, t),
          lerp(prev.a, point.a, t)
        );
      }
      prev = point;
    }
  }

  // 收筆：把完成的筆畫整條疊進墨層（與即時顯示同為 source-over，外觀不跳動）
  function commitStroke() {
    if (pointer.points.length > 0) {
      drawActiveStroke();
      inkContext.save();
      inkContext.setTransform(1, 0, 0, 1, 0, 0);
      inkContext.globalCompositeOperation = "source-over";
      // 與即時顯示（圖層 opacity=density）一致，烘焙時也用濃度當整體不透明度
      inkContext.globalAlpha = clamp(state.density, 0, 1);
      inkContext.drawImage(strokeCanvas, 0, 0);
      inkContext.restore();
    }
    clearStrokeLayer();
    pointer.points = [];
    strokeDirty = false;
  }

  function appendPoint(point) {
    pointer.points.push(point);
    strokeDirty = true;
    // 軟上限：避免單一超長筆畫無限累積，超過就先把目前段落烘進墨層、保留接點續畫
    if (pointer.points.length > 400) {
      const last = pointer.points[pointer.points.length - 1];
      commitStroke();
      pointer.points = [last];
    }
  }

  function finishStroke() {
    pointer.active = false;
    commitStroke();
  }

  function setPointerPosition(event) {
    const rect = inputCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function animate() {
    if (pointer.active) {
      pointer.stillFrames += 1;
      // 長按不動：持續加暈染點，模擬墨往紙纖維滲開（不再直接蓋深色墨塊）
      if (pointer.stillFrames % 6 === 0) {
        addBleed(pointer.x, pointer.y, 0.7);
      }
    }

    if (strokeDirty) {
      drawActiveStroke();
      strokeDirty = false;
    }

    inkContext.save();
    // 暈染與筆跡同樣用 source-over 疊在墨層，兩者才會自然融在一起、不會有明顯分隔
    inkContext.globalCompositeOperation = "source-over";
    for (let index = bleeds.length - 1; index >= 0; index -= 1) {
      const bleed = bleeds[index];
      // 暈染擴散速度大幅拉開差距：低暈染幾乎不擴散、高暈染快速化開一大片
      bleed.r += 0.12 + state.bleed * 4;
      bleed.alpha *= 0.92;
      for (const lobe of bleed.lobes) {
        // 以多個偏移子瓣累積暈染，避免單一同心圓造成硬邊。
        const spread = state.bleed * bleed.r * 0.3;
        const lobeX = bleed.x + lobe.x + Math.sign(lobe.x || 1) * spread * lobe.grow;
        const lobeY = bleed.y + lobe.y + Math.sign(lobe.y || 1) * spread * lobe.grow;
        const lobeRadius = bleed.r * lobe.r;
        const gradient = inkContext.createRadialGradient(lobeX, lobeY, 0, lobeX, lobeY, lobeRadius);
        gradient.addColorStop(0, rgba(bleed.alpha * lobe.alpha * 0.3));
        gradient.addColorStop(0.28, rgba(bleed.alpha * lobe.alpha * 0.19));
        gradient.addColorStop(0.56, rgba(bleed.alpha * lobe.alpha * 0.1));
        gradient.addColorStop(0.82, rgba(bleed.alpha * lobe.alpha * 0.035));
        gradient.addColorStop(1, rgba(0));
        inkContext.fillStyle = gradient;
        inkContext.beginPath();
        inkContext.arc(lobeX, lobeY, lobeRadius, 0, Math.PI * 2);
        inkContext.fill();
      }
      if (bleed.alpha < 0.005) {
        bleeds.splice(index, 1);
      }
    }
    inkContext.restore();

    animationId = window.requestAnimationFrame(animate);
  }

  inputCanvas.addEventListener("pointerdown", (event) => {
    const point = setPointerPosition(event);
    pointer.active = true;
    pointer.id = event.pointerId;
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.time = event.timeStamp || performance.now();
    pointer.stillFrames = 0;
    pointer.points = [strokePoint(point.x, point.y, 0)];
    strokeDirty = true;
    inputCanvas.setPointerCapture(event.pointerId);
    addBleed(point.x, point.y, 0.7);
  });

  inputCanvas.addEventListener("pointermove", (event) => {
    if (!pointer.active || event.pointerId !== pointer.id) {
      return;
    }
    const point = setPointerPosition(event);
    const now = event.timeStamp || performance.now();
    const dx = point.x - pointer.x;
    const dy = point.y - pointer.y;
    const distance = Math.hypot(dx, dy);
    const speed = distance / Math.max(1, now - pointer.time);
    // 事件取樣較疏時補插中間點；每個點依速度帶不同濃淡與粗細
    const steps = Math.max(1, Math.ceil(distance / Math.max(3, state.size * 0.2)));
    for (let step = 1; step <= steps; step += 1) {
      appendPoint(strokePoint(pointer.x + dx * step / steps, pointer.y + dy * step / steps, speed));
    }
    // 沿整條筆畫都產生暈染（慢筆滲得更開），讓墨跡邊緣有水墨化開的感覺
    if (Math.random() < 0.08 + state.bleed * 0.5) {
      addBleed(point.x, point.y, speed < 0.22 ? 0.85 : 0.5);
    }
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.time = now;
    pointer.stillFrames = 0;
  });

  inputCanvas.addEventListener("pointerup", (event) => {
    if (!pointer.active || event.pointerId !== pointer.id) {
      return;
    }
    try {
      inputCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // 某些瀏覽器在指標已取消時會丟錯，忽略可維持收筆流程。
    }
    finishStroke();
  });

  inputCanvas.addEventListener("pointercancel", () => {
    finishStroke();
  });

  inputCanvas.addEventListener("lostpointercapture", () => {
    if (pointer.active) {
      finishStroke();
    }
  });

  shell.addParam({
    type: "range",
    key: "density",
    label: "墨色濃度",
    min: 0.05,
    max: 1,
    step: 0.01,
    value: state.density,
    onChange(value) {
      state.density = value;
      // 濃度即時反映到筆畫圖層不透明度
      strokeCanvas.style.opacity = String(clamp(value, 0, 1));
    }
  });

  shell.addParam({
    type: "range",
    key: "bleed",
    label: "暈染擴散",
    min: 0,
    max: 1,
    step: 0.01,
    value: state.bleed,
    onChange(value) {
      state.bleed = value;
    }
  });

  shell.addParam({
    type: "range",
    key: "size",
    label: "筆刷大小",
    min: 4,
    max: 80,
    step: 1,
    value: state.size,
    onChange(value) {
      state.size = value;
    }
  });

  shell.addParam({
    type: "color",
    key: "ink",
    label: "筆墨顏色",
    value: state.ink,
    onChange(value) {
      state.ink = value;
    }
  });

  shell.addButton({
    label: "清空畫布",
    onClick() {
      clearInk();
    }
  });

  window.addEventListener("resize", resize);
  resize();
  animationId = window.requestAnimationFrame(animate);

  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(animationId);
  });
})();
