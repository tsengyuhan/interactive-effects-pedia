(function () {
  "use strict";

  const shell = Shell.init({ id: "ink-brush" });
  const paperCanvas = document.createElement("canvas");
  const inkCanvas = document.createElement("canvas");
  const inputCanvas = document.createElement("canvas");
  const paperContext = paperCanvas.getContext("2d");
  const inkContext = inkCanvas.getContext("2d");
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
    stillFrames: 0
  };
  const bleeds = [];

  let width = 1;
  let height = 1;
  let ratio = 1;
  let animationId = 0;

  for (const canvas of [paperCanvas, inkCanvas, inputCanvas]) {
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
  }

  paperCanvas.style.zIndex = "0";
  inkCanvas.style.zIndex = "1";
  inputCanvas.style.zIndex = "2";
  inputCanvas.style.touchAction = "none";
  inputContext.canvas.setAttribute("aria-label", "水墨筆觸畫布");

  shell.container.style.overflow = "hidden";
  shell.container.append(paperCanvas, inkCanvas, inputCanvas);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function clearInk() {
    bleeds.length = 0;
    inkContext.clearRect(0, 0, width, height);
  }

  function resize() {
    ratio = window.devicePixelRatio || 1;
    width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    prepareCanvas(paperCanvas, paperContext);
    prepareCanvas(inkCanvas, inkContext);
    prepareCanvas(inputCanvas, inputContext);
    drawPaper();
    // 尺寸改變時舊墨跡比例難以準確保留，清除可避免變形。
    clearInk();
  }

  function stamp(x, y, radius, alpha) {
    const points = [];
    const count = 8 + Math.floor(Math.random() * 5);
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i += 1) {
      const angle = start + i / count * Math.PI * 2;
      const wobble = 0.7 + Math.random() * 0.6;
      points.push({
        x: x + Math.cos(angle) * radius * wobble,
        y: y + Math.sin(angle) * radius * wobble
      });
    }

    const gradient = inkContext.createRadialGradient(x, y, 0, x, y, radius * 1.25);
    gradient.addColorStop(0, rgba(alpha));
    gradient.addColorStop(0.32, rgba(alpha * 0.76));
    gradient.addColorStop(0.62, rgba(alpha * 0.34));
    gradient.addColorStop(0.86, rgba(alpha * 0.08));
    gradient.addColorStop(1, rgba(0));
    inkContext.save();
    inkContext.globalCompositeOperation = "multiply";
    inkContext.fillStyle = gradient;
    inkContext.beginPath();
    inkContext.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      inkContext.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    inkContext.closePath();
    inkContext.fill();
    inkContext.restore();
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
      r: state.size * (0.34 + Math.random() * 0.18),
      alpha: state.density * strength * 0.07,
      lobes
    });
  }

  function drawSegment(fromX, fromY, toX, toY, elapsed) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = distance / Math.max(1, elapsed);
    const spacing = Math.max(1.5, state.size / 4);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    const fast = clamp((speed - 0.32) / 1.35, 0, 1);

    for (let step = 1; step <= steps; step += 1) {
      if (fast > 0 && Math.random() < fast * 0.45) {
        continue;
      }
      const t = step / steps;
      const x = fromX + dx * t + (Math.random() - 0.5) * state.size * 0.12;
      const y = fromY + dy * t + (Math.random() - 0.5) * state.size * 0.12;
      const alpha = state.density * (0.48 - fast * 0.28) * (0.78 + Math.random() * 0.28);
      const radius = state.size * (0.46 - fast * 0.12) * (0.88 + Math.random() * 0.22);
      stamp(x, y, radius, alpha);
      if (speed < 0.22 && Math.random() < 0.45 + state.bleed * 0.4) {
        addBleed(x, y, 0.65);
      }
    }
  }

  function setPointerPosition(event) {
    const rect = inputCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function endStroke(event) {
    if (!pointer.active || event.pointerId !== pointer.id) {
      return;
    }
    pointer.active = false;
    try {
      inputCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // 某些瀏覽器在指標已取消時會丟錯，忽略可維持收筆流程。
    }
  }

  function animate() {
    if (pointer.active) {
      pointer.stillFrames += 1;
      if (pointer.stillFrames % 5 === 0) {
        stamp(pointer.x, pointer.y, state.size * (0.48 + Math.random() * 0.08), state.density * 0.11);
        addBleed(pointer.x, pointer.y, 0.9);
      }
    }

    inkContext.save();
    inkContext.globalCompositeOperation = "multiply";
    for (let index = bleeds.length - 1; index >= 0; index -= 1) {
      const bleed = bleeds[index];
      bleed.r += 0.22 + state.bleed * 1.7;
      bleed.alpha *= 0.92;
      for (const lobe of bleed.lobes) {
        // 以多個偏移子瓣累積暈染，避免單一同心圓造成硬邊。
        const spread = state.bleed * bleed.r * 0.16;
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
    inputCanvas.setPointerCapture(event.pointerId);
    stamp(pointer.x, pointer.y, state.size * 0.5, state.density * 0.58);
    addBleed(pointer.x, pointer.y, 0.8);
  });

  inputCanvas.addEventListener("pointermove", (event) => {
    if (!pointer.active || event.pointerId !== pointer.id) {
      return;
    }
    const point = setPointerPosition(event);
    const now = event.timeStamp || performance.now();
    drawSegment(pointer.x, pointer.y, point.x, point.y, now - pointer.time);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.time = now;
    pointer.stillFrames = 0;
  });

  inputCanvas.addEventListener("pointerup", endStroke);
  inputCanvas.addEventListener("pointercancel", endStroke);
  inputCanvas.addEventListener("lostpointercapture", () => {
    pointer.active = false;
  });

  shell.addParam({
    type: "range",
    key: "density",
    label: "墨色濃度",
    min: 0.1,
    max: 1,
    step: 0.01,
    value: state.density,
    onChange(value) {
      state.density = value;
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
