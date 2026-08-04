(function () {
  "use strict";

  const shell = Shell.init({ id: "sound-firework" });
  // 兩層畫布：火星層靠半透明覆蓋留拖尾，貓咪層每格清空才不會糊成一團
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const catCanvas = document.createElement("canvas");
  const catContext = catCanvas.getContext("2d");
  // 染色暫存：貓咪原圖是淺奶油色，疊上煙火顏色後才畫到主畫布
  const tintCanvas = document.createElement("canvas");
  const tintContext = tintCanvas.getContext("2d");
  const meter = document.createElement("div");

  const FRAME_COUNT = 6;
  const STEP_MS = 1000 / 12; // 逐格動畫：整套模擬固定跑 12 fps，刻意保留頓挫感
  const RISE_MS = 1150;
  const errorMessage = "請允許麥克風權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";

  const audio = {
    context: null,
    analyser: null,
    stream: null,
    wave: null,
    spectrum: null,
    sampleRate: 44100,
    db: -60,
    brightness: 0.5,
    wasAbove: false,
    lastLaunch: 0
  };

  const state = {
    threshold: -34,
    size: 1,
    color: "#ffd166"
  };

  const display = { width: 1, height: 1, animationId: 0, lastStep: 0 };
  const frames = [];
  const rockets = [];
  const sparks = [];
  const stars = [];
  const pending = [];
  let baseHue = 45;
  let framesReady = false;

  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";

  catCanvas.style.position = "absolute";
  catCanvas.style.inset = "0";
  catCanvas.style.width = "100%";
  catCanvas.style.height = "100%";
  catCanvas.style.display = "block";

  meter.style.position = "absolute";
  meter.style.left = "18px";
  meter.style.top = "70px";
  meter.style.zIndex = "2";
  meter.style.width = "min(240px, calc(100vw - 36px))";
  meter.style.border = "1px solid rgba(255, 255, 255, 0.14)";
  meter.style.borderRadius = "8px";
  meter.style.padding = "12px";
  meter.style.background = "rgba(6, 8, 18, 0.66)";
  meter.style.color = "#f3efe6";
  meter.style.font = "14px/1.45 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  meter.style.backdropFilter = "blur(14px)";

  shell.container.style.background = "#05060f";
  shell.container.append(canvas, catCanvas, meter);

  shell.addParam({
    type: "range",
    key: "threshold",
    label: "觸發音量",
    min: -55,
    max: -10,
    step: 1,
    value: state.threshold,
    onChange(value) {
      state.threshold = value;
    }
  });

  shell.addParam({
    type: "range",
    key: "size",
    label: "煙火大小",
    min: 0.5,
    max: 2,
    step: 0.05,
    value: state.size,
    onChange(value) {
      state.size = value;
    }
  });

  shell.addParam({
    type: "color",
    key: "color",
    label: "煙火顏色",
    value: state.color,
    onChange(value) {
      state.color = value;
      baseHue = hexToHue(value);
    }
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalize(value, min, max) {
    return clamp((value - min) / (max - min), 0, 1);
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function hexToHue(hex) {
    const value = parseInt(hex.slice(1), 16);
    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta === 0) {
      return 45;
    }
    let hue;
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    return (hue * 60 + 360) % 360;
  }

  function resize() {
    display.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    display.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    canvas.width = Math.floor(display.width);
    canvas.height = Math.floor(display.height);
    catCanvas.width = canvas.width;
    catCanvas.height = canvas.height;
    context.fillStyle = "#05060f";
    context.fillRect(0, 0, display.width, display.height);
    buildStars();
  }

  function buildStars() {
    stars.length = 0;
    const count = Math.round(display.width * display.height / 26000);
    for (let i = 0; i < count; i += 1) {
      stars.push({
        x: Math.random() * display.width,
        y: Math.random() * display.height * 0.85,
        r: Math.random() * 1.1 + 0.3,
        a: Math.random() * 0.5 + 0.15
      });
    }
  }

  function loadFrames() {
    let loaded = 0;
    for (let i = 0; i < FRAME_COUNT; i += 1) {
      const image = new Image();
      image.onload = () => {
        loaded += 1;
        if (loaded === FRAME_COUNT) {
          framesReady = true;
        }
      };
      image.onerror = () => {
        shell.showError("貓咪序列圖載入失敗，請確認 frames/ 資料夾內的圖檔完整");
      };
      image.src = `frames/cat-0${i + 1}.png`;
      frames.push(image);
    }
  }

  function launch(power, brightness) {
    const hue = (baseHue + (Math.random() - 0.5) * 50 + 360) % 360;
    const base = Math.min(display.width, display.height) * 0.16 * state.size;
    rockets.push({
      x: display.width * (0.15 + Math.random() * 0.7),
      drift: (Math.random() - 0.5) * display.width * 0.06,
      apexY: display.height * lerp(0.52, 0.14, brightness),
      elapsed: 0,
      base: base * lerp(0.8, 1.25, power),
      power,
      hue,
      spin: (Math.random() - 0.5) * 0.24
    });
  }

  function burst(rocket, x, y, scale) {
    const count = Math.round(lerp(26, 64, rocket.power) * clamp(state.size, 0.6, 1.6));
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (Math.random() * 0.7 + 0.35) * scale * 26;
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - scale * 4,
        life: 1,
        decay: 0.045 + Math.random() * 0.05,
        r: (Math.random() * 3 + 2) * clamp(state.size, 0.6, 1.6),
        hue: (rocket.hue + (Math.random() - 0.5) * 40 + 360) % 360
      });
    }
  }

  function step() {
    while (pending.length) {
      const item = pending.shift();
      launch(item.power, item.brightness);
    }

    for (let i = rockets.length - 1; i >= 0; i -= 1) {
      const rocket = rockets[i];
      rocket.elapsed += STEP_MS;
      const progress = rocket.elapsed / RISE_MS;
      if (progress >= 1) {
        const scale = state.size;
        burst(rocket, rocket.x + rocket.drift, rocket.apexY, scale);
        rockets.splice(i, 1);
        continue;
      }
      // 上升時每格灑一點火星尾巴
      if (Math.random() < 0.7) {
        const eased = 1 - Math.pow(1 - progress, 2.1);
        const y = lerp(display.height + rocket.base * 0.6, rocket.apexY, eased);
        sparks.push({
          x: rocket.x + rocket.drift * eased + (Math.random() - 0.5) * rocket.base * 0.4,
          y: y + rocket.base * 0.35,
          vx: (Math.random() - 0.5) * 3,
          vy: Math.random() * 4 + 1,
          life: 0.7,
          decay: 0.09,
          r: Math.random() * 2 + 1.2,
          hue: rocket.hue
        });
      }
    }

    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vy += 1.5;
      spark.vx *= 0.96;
      spark.vy *= 0.96;
      spark.life -= spark.decay;
      if (spark.life <= 0 || spark.y > display.height + 40) {
        sparks.splice(i, 1);
      }
    }
  }

  function drawCat(rocket) {
    const progress = clamp(rocket.elapsed / RISE_MS, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 2.1);
    const frameIndex = Math.min(FRAME_COUNT - 1, Math.floor(progress * FRAME_COUNT));
    const image = frames[frameIndex];
    if (!image || !image.complete || !image.naturalWidth) {
      return;
    }

    const size = rocket.base * lerp(0.4, 1, eased);
    const x = rocket.x + rocket.drift * eased;
    const y = lerp(display.height + size * 0.6, rocket.apexY, eased);

    const side = Math.max(2, Math.round(size));
    tintCanvas.width = side;
    tintCanvas.height = side;
    tintContext.clearRect(0, 0, side, side);
    tintContext.drawImage(image, 0, 0, side, side);
    tintContext.globalCompositeOperation = "source-atop";
    tintContext.fillStyle = `hsl(${rocket.hue}, 85%, 62%)`;
    tintContext.globalAlpha = 0.5;
    tintContext.fillRect(0, 0, side, side);
    tintContext.globalAlpha = 1;
    tintContext.globalCompositeOperation = "source-over";

    catContext.save();
    catContext.translate(x, y);
    catContext.rotate(rocket.spin * (1 - eased));
    catContext.shadowColor = `hsla(${rocket.hue}, 90%, 65%, 0.9)`;
    catContext.shadowBlur = size * 0.35;
    catContext.drawImage(tintCanvas, -side / 2, -side / 2, side, side);
    catContext.restore();
  }

  function draw() {
    // 半透明黑底取代 clear，讓火星自然留下拖尾
    context.fillStyle = "rgba(5, 6, 15, 0.34)";
    context.fillRect(0, 0, display.width, display.height);

    context.globalCompositeOperation = "lighter";
    for (const star of stars) {
      context.fillStyle = `rgba(255, 250, 235, ${star.a})`;
      context.beginPath();
      context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      context.fill();
    }

    for (const spark of sparks) {
      const alpha = clamp(spark.life, 0, 1);
      const gradient = context.createRadialGradient(spark.x, spark.y, 0, spark.x, spark.y, spark.r * 3);
      gradient.addColorStop(0, `hsla(${spark.hue}, 95%, 78%, ${alpha})`);
      gradient.addColorStop(1, `hsla(${spark.hue}, 95%, 55%, 0)`);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(spark.x, spark.y, spark.r * 3, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";

    catContext.clearRect(0, 0, display.width, display.height);
    for (const rocket of rockets) {
      drawCat(rocket);
    }
  }

  function computeVolume(wave) {
    let sum = 0;
    for (let i = 0; i < wave.length; i += 1) {
      sum += wave[i] * wave[i];
    }
    const rms = Math.sqrt(sum / wave.length);
    return clamp(20 * Math.log10(Math.max(rms, 0.000001)), -60, 0);
  }

  function computeBrightness(spectrum) {
    // 頻譜重心當「音高高低」的近似，比自相關便宜且對打擊樂更穩
    let weighted = 0;
    let total = 0;
    for (let i = 0; i < spectrum.length; i += 1) {
      weighted += i * spectrum[i];
      total += spectrum[i];
    }
    if (total < 1) {
      return 0.5;
    }
    const centroidHz = (weighted / total) * (audio.sampleRate / 2) / spectrum.length;
    return normalize(Math.log2(Math.max(centroidHz, 80)), Math.log2(80), Math.log2(6000));
  }

  function analyzeAudio(now) {
    if (!audio.analyser) {
      return;
    }
    audio.analyser.getFloatTimeDomainData(audio.wave);
    audio.analyser.getByteFrequencyData(audio.spectrum);
    audio.db = computeVolume(audio.wave);
    audio.brightness = computeBrightness(audio.spectrum);

    const above = audio.db > state.threshold;
    const rising = above && !audio.wasAbove;
    audio.wasAbove = above;
    // 只在跨過門檻的起音瞬間發射，90ms 不應期讓鼓點可以連發又不會爆量
    if (rising && now - audio.lastLaunch > 90) {
      audio.lastLaunch = now;
      pending.push({
        power: normalize(audio.db, state.threshold, -4),
        brightness: audio.brightness
      });
    }
  }

  function updateMeter() {
    const volumeAmount = normalize(audio.db, -60, 0) * 100;
    const thresholdAmount = normalize(state.threshold, -60, 0) * 100;
    meter.innerHTML = [
      `<div style="display:flex;justify-content:space-between;gap:12px"><span>音量</span><strong>${audio.db.toFixed(1)} dB</strong></div>`,
      `<div style="position:relative;height:8px;margin:7px 0 10px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden">`,
      `<div style="height:100%;width:${volumeAmount}%;background:#ffd166"></div>`,
      `<div style="position:absolute;top:-2px;left:${thresholdAmount}%;width:2px;height:12px;background:#ff7b7b"></div></div>`,
      `<div style="color:rgba(243,239,230,.75);font-size:12px">紅線是觸發音量，超過就發射一顆貓咪</div>`
    ].join("");
  }

  function render(now) {
    analyzeAudio(now);
    if (!display.lastStep) {
      display.lastStep = now;
    }
    if (now - display.lastStep >= STEP_MS) {
      display.lastStep = now;
      if (framesReady) {
        step();
      } else {
        pending.length = 0;
      }
      draw();
      updateMeter();
    }
    display.animationId = window.requestAnimationFrame(render);
  }

  async function resumeAudio() {
    if (audio.context && audio.context.state === "suspended") {
      await audio.context.resume();
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

    const request = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    const timeout = new Promise((resolve, reject) => {
      window.setTimeout(() => {
        reject(new Error("microphone permission timeout"));
      }, 20000);
    });
    // 無裝置或無人回應權限視窗時，逾時比永遠卡住好
    audio.stream = await Promise.race([request, timeout]);

    audio.context = new AudioContextClass();
    const source = audio.context.createMediaStreamSource(audio.stream);
    audio.analyser = audio.context.createAnalyser();
    audio.analyser.fftSize = 2048;
    audio.analyser.smoothingTimeConstant = 0;
    source.connect(audio.analyser);
    audio.sampleRate = audio.context.sampleRate;
    audio.wave = new Float32Array(audio.analyser.fftSize);
    audio.spectrum = new Uint8Array(audio.analyser.frequencyBinCount);
    resumeAudio().catch(() => {});
  }

  function bindAudioResume() {
    const handler = () => {
      resumeAudio().catch(() => {});
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", handler);
  }

  async function start() {
    try {
      resize();
      loadFrames();
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
    if (audio.stream) {
      for (const track of audio.stream.getTracks()) {
        track.stop();
      }
    }
    if (audio.context && audio.context.state !== "closed") {
      audio.context.close();
    }
  });

  baseHue = hexToHue(state.color);
  start();
})();
