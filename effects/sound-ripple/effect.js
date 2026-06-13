(function () {
  "use strict";

  const shell = Shell.init({ id: "sound-ripple" });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const bufferCanvas = document.createElement("canvas");
  const bufferContext = bufferCanvas.getContext("2d", { willReadFrequently: true });
  const meter = document.createElement("div");

  const errorMessage = "請允許麥克風權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
  const audioState = {
    context: null,
    analyser: null,
    stream: null,
    wave: null,
    sampleRate: 44100,
    db: -60,
    pitch: null,
    pitchConfidence: 0,
    lastDropTime: 0
  };

  const water = {
    scale: 4,
    width: 1,
    height: 1,
    previous: new Float32Array(1),
    current: new Float32Array(1),
    image: null,
    damping: 0.985
  };

  const display = {
    width: 1,
    height: 1,
    animationId: 0
  };

  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";

  meter.style.position = "absolute";
  meter.style.left = "18px";
  meter.style.top = "70px";
  meter.style.zIndex = "2";
  meter.style.width = "min(260px, calc(100vw - 36px))";
  meter.style.border = "1px solid rgba(255, 255, 255, 0.16)";
  meter.style.borderRadius = "8px";
  meter.style.padding = "12px";
  meter.style.background = "rgba(3, 12, 15, 0.68)";
  meter.style.color = "#eef8f2";
  meter.style.font = "14px/1.45 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  meter.style.backdropFilter = "blur(14px)";

  shell.container.style.background = "#031012";
  shell.container.append(canvas, meter);
  context.imageSmoothingEnabled = true;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalize(value, min, max) {
    return clamp((value - min) / (max - min), 0, 1);
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function resize() {
    display.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    display.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    canvas.width = Math.floor(display.width);
    canvas.height = Math.floor(display.height);
    context.imageSmoothingEnabled = true;

    water.width = Math.max(2, Math.floor(display.width / water.scale));
    water.height = Math.max(2, Math.floor(display.height / water.scale));
    water.previous = new Float32Array(water.width * water.height);
    water.current = new Float32Array(water.width * water.height);
    bufferCanvas.width = water.width;
    bufferCanvas.height = water.height;
    water.image = bufferContext.createImageData(water.width, water.height);
  }

  function gaussian() {
    let u = 0;
    let v = 0;
    while (u === 0) {
      u = Math.random();
    }
    while (v === 0) {
      v = Math.random();
    }
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function addDrop(x, y, radius, depth) {
    const minX = Math.max(1, Math.floor(x - radius));
    const maxX = Math.min(water.width - 2, Math.ceil(x + radius));
    const minY = Math.max(1, Math.floor(y - radius));
    const maxY = Math.min(water.height - 2, Math.ceil(y + radius));
    for (let yy = minY; yy <= maxY; yy += 1) {
      for (let xx = minX; xx <= maxX; xx += 1) {
        const dx = xx - x;
        const dy = yy - y;
        const distance = Math.hypot(dx, dy);
        if (distance <= radius) {
          const falloff = Math.cos(distance / radius * Math.PI) * 0.5 + 0.5;
          water.previous[yy * water.width + xx] -= depth * falloff;
        }
      }
    }
  }

  function maybeDrop(now) {
    if (audioState.db <= -45 || now - audioState.lastDropTime < 80) {
      return;
    }
    const power = normalize(audioState.db, -45, 0);
    const x = clamp(water.width * (0.5 + gaussian() * 0.18), 2, water.width - 3);
    const y = clamp(water.height * (0.5 + gaussian() * 0.18), 2, water.height - 3);
    addDrop(x, y, lerp(3.5, 13, power), lerp(90, 420, power));
    audioState.lastDropTime = now;
  }

  function updateDamping() {
    if (!audioState.pitch) {
      water.damping = 0.985;
      return;
    }
    const amount = normalize(audioState.pitch, 60, 1200);
    // 規格允許方向對調；這裡採低音餘波長、高音短促的直覺映射。
    water.damping = lerp(0.995, 0.96, amount);
  }

  function simulateWater() {
    const w = water.width;
    const h = water.height;
    const previous = water.previous;
    const current = water.current;
    const damping = water.damping;

    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        let v = (previous[i - 1] + previous[i + 1] + previous[i - w] + previous[i + w]) / 2 - current[i];
        current[i] = v * damping;
      }
    }

    // 邊界保留鄰近高度，讓波碰邊時反射回場內而不是直接消失。
    for (let x = 1; x < w - 1; x += 1) {
      current[x] = current[w + x] * 0.92;
      current[(h - 1) * w + x] = current[(h - 2) * w + x] * 0.92;
    }
    for (let y = 1; y < h - 1; y += 1) {
      current[y * w] = current[y * w + 1] * 0.92;
      current[y * w + w - 1] = current[y * w + w - 2] * 0.92;
    }

    water.previous = current;
    water.current = previous;
  }

  function renderWater() {
    const w = water.width;
    const h = water.height;
    const field = water.previous;
    const data = water.image.data;
    const base = { r: 8, g: 62, b: 68 };

    for (let y = 0; y < h; y += 1) {
      const ym = clamp(y - 1, 0, h - 1);
      const yp = clamp(y + 1, 0, h - 1);
      for (let x = 0; x < w; x += 1) {
        const xm = clamp(x - 1, 0, w - 1);
        const xp = clamp(x + 1, 0, w - 1);
        const i = y * w + x;
        const gx = field[y * w + xp] - field[y * w + xm];
        const gy = field[yp * w + x] - field[ym * w + x];
        const shade = clamp(0.5 + gx * 0.018 + gy * 0.024, 0, 1);
        const bend = clamp((gx - gy) * 0.018, -18, 18);
        const p = i * 4;
        data[p] = clamp(base.r + shade * 42 + bend, 0, 255);
        data[p + 1] = clamp(base.g + shade * 86 + bend * 0.7, 0, 255);
        data[p + 2] = clamp(base.b + shade * 76 - bend * 0.35, 0, 255);
        data[p + 3] = 255;
      }
    }

    bufferContext.putImageData(water.image, 0, 0);
    context.clearRect(0, 0, display.width, display.height);
    context.drawImage(bufferCanvas, 0, 0, display.width, display.height);
  }

  function computeVolume(wave) {
    let sum = 0;
    for (let i = 0; i < wave.length; i += 1) {
      sum += wave[i] * wave[i];
    }
    const rms = Math.sqrt(sum / wave.length);
    return clamp(20 * Math.log10(Math.max(rms, 0.000001)), -60, 0);
  }

  function detectPitch(wave, sampleRate, db) {
    if (db < -50) {
      return { pitch: null, confidence: 0 };
    }

    const minLag = Math.floor(sampleRate / 1200);
    const maxLag = Math.min(Math.floor(sampleRate / 60), wave.length - 1);
    let bestLag = 0;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let cross = 0;
      let energyA = 0;
      let energyB = 0;
      for (let i = 0; i < wave.length - lag; i += 1) {
        const a = wave[i];
        const b = wave[i + lag];
        cross += a * b;
        energyA += a * a;
        energyB += b * b;
      }
      const denominator = Math.sqrt(energyA * energyB);
      const correlation = denominator > 0 ? cross / denominator : 0;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestCorrelation < 0.9 || bestLag <= 0) {
      return { pitch: null, confidence: bestCorrelation };
    }
    return { pitch: sampleRate / bestLag, confidence: bestCorrelation };
  }

  function analyzeAudio() {
    if (!audioState.analyser || !audioState.wave) {
      return;
    }
    audioState.analyser.getFloatTimeDomainData(audioState.wave);
    audioState.db = computeVolume(audioState.wave);
    const result = detectPitch(audioState.wave, audioState.sampleRate, audioState.db);
    audioState.pitch = result.pitch;
    audioState.pitchConfidence = result.confidence;
  }

  function updateMeter() {
    const dbText = `${audioState.db.toFixed(1)} dB`;
    const pitchText = audioState.pitch ? `${Math.round(audioState.pitch)} Hz` : "—";
    const volumeAmount = normalize(audioState.db, -60, 0) * 100;
    const pitchAmount = audioState.pitch ? normalize(audioState.pitch, 60, 1200) * 100 : 0;
    meter.innerHTML = [
      `<div style="display:flex;justify-content:space-between;gap:12px"><span>音量</span><strong>${dbText}</strong></div>`,
      `<div style="height:8px;margin:7px 0 12px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden"><div style="height:100%;width:${volumeAmount}%;background:#7ee3d5"></div></div>`,
      `<div style="display:flex;justify-content:space-between;gap:12px"><span>音高</span><strong>${pitchText}</strong></div>`,
      `<div style="height:8px;margin-top:7px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden"><div style="height:100%;width:${pitchAmount}%;background:#d6e77a"></div></div>`
    ].join("");
  }

  function render(now) {
    analyzeAudio();
    updateDamping();
    maybeDrop(now);
    simulateWater();
    renderWater();
    updateMeter();
    display.animationId = window.requestAnimationFrame(render);
  }

  async function resumeAudio() {
    if (audioState.context && audioState.context.state === "suspended") {
      await audioState.context.resume();
    }
  }

  async function setupAudio() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw new Error("mediaDevices unavailable");
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext unavailable");
    }

    const request = navigator.mediaDevices.getUserMedia({ audio: true });
    const timeout = new Promise((resolve, reject) => {
      window.setTimeout(() => {
        reject(new Error("microphone permission timeout"));
      }, 20000);
    });
    // Headless 或無麥克風環境可能讓權限請求懸置，逾時可避免只剩靜態畫面。
    audioState.stream = await Promise.race([request, timeout]);
    audioState.context = new AudioContextClass();
    const source = audioState.context.createMediaStreamSource(audioState.stream);
    audioState.analyser = audioState.context.createAnalyser();
    audioState.analyser.fftSize = 2048;
    audioState.analyser.smoothingTimeConstant = 0;
    source.connect(audioState.analyser);
    audioState.sampleRate = audioState.context.sampleRate;
    audioState.wave = new Float32Array(audioState.analyser.fftSize);
    // 先完成音訊管線；若瀏覽器要求手勢，事件監聽會在下一次互動時補 resume。
    resumeAudio().catch(() => {});
  }

  function bindAudioResume() {
    const handler = () => {
      resumeAudio().catch(() => {});
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", handler);
    window.addEventListener("click", handler);
  }

  async function start() {
    try {
      resize();
      updateMeter();
      bindAudioResume();
      display.animationId = window.requestAnimationFrame(render);
      await setupAudio();
    } catch (error) {
      console.error(error);
      shell.showError(errorMessage);
    }
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(display.animationId);
    if (audioState.stream) {
      for (const track of audioState.stream.getTracks()) {
        track.stop();
      }
    }
    if (audioState.context && audioState.context.state !== "closed") {
      audioState.context.close();
    }
  });

  start();
})();
