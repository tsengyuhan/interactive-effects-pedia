(function () {
  "use strict";

  const shell = Shell.init({ id: "sound-firework" });
  // 三層畫布：夜空只畫一次當底、火星層靠半透明覆蓋留拖尾、貓咪層每格清空才不會糊
  const skyCanvas = document.createElement("canvas");
  const skyContext = skyCanvas.getContext("2d");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const catCanvas = document.createElement("canvas");
  const catContext = catCanvas.getContext("2d");
  // 染色暫存：貓咪原圖是淺奶油色，疊上煙火顏色後才畫到貓咪層
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
  const strokes = [];
  const pending = [];
  let baseHue = 45;
  let framesReady = false;

  for (const element of [skyCanvas, canvas, catCanvas]) {
    element.style.position = "absolute";
    element.style.inset = "0";
    element.style.width = "100%";
    element.style.height = "100%";
    element.style.display = "block";
  }

  meter.style.position = "absolute";
  meter.style.left = "18px";
  meter.style.top = "70px";
  meter.style.zIndex = "2";
  meter.style.width = "min(240px, calc(100vw - 36px))";
  meter.style.border = "1px solid rgba(255, 255, 255, 0.14)";
  meter.style.borderRadius = "8px";
  meter.style.padding = "12px";
  meter.style.background = "rgba(9, 14, 38, 0.66)";
  meter.style.color = "#f3efe6";
  meter.style.font = "14px/1.45 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  meter.style.backdropFilter = "blur(14px)";

  shell.container.style.background = "#080e26";
  shell.container.append(skyCanvas, canvas, catCanvas, meter);

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

  function random(min, max) {
    return min + Math.random() * (max - min);
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

  // 用粗筆刷把夜空刷出來：深藍底＋大筆觸＋刮痕＋金色顏料點，只畫一次
  function paintSky() {
    const w = display.width;
    const h = display.height;
    skyContext.setTransform(1, 0, 0, 1, 0, 0);
    skyContext.fillStyle = "#0a1230";
    skyContext.fillRect(0, 0, w, h);

    // 方頭筆刷、方向大致一致地反覆疊塗——圓頭粗線會變成一根根膠囊，不像油畫
    skyContext.lineCap = "butt";
    const dominant = random(0, Math.PI);
    for (let i = 0; i < 260; i += 1) {
      const x = random(-0.05, 1.05) * w;
      const y = random(-0.05, 1.05) * h;
      const angle = dominant + random(-0.55, 0.55);
      const length = random(50, 260);
      skyContext.strokeStyle = `hsla(${random(212, 252)}, ${random(34, 62)}%, ${random(8, 22)}%, ${random(0.1, 0.3)})`;
      skyContext.lineWidth = random(9, 34);
      skyContext.beginPath();
      skyContext.moveTo(x, y);
      skyContext.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      skyContext.stroke();
    }

    // 乾筆刮痕，讓底不要太勻
    for (let i = 0; i < 220; i += 1) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const angle = dominant + random(-0.5, 0.5);
      const length = random(20, 190);
      skyContext.strokeStyle = `hsla(${random(200, 250)}, ${random(30, 60)}%, ${random(4, 34)}%, ${random(0.06, 0.22)})`;
      skyContext.lineWidth = random(1, 4);
      skyContext.beginPath();
      skyContext.moveTo(x, y);
      skyContext.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      skyContext.stroke();
    }

    // 金色與白色顏料點，取代規矩的圓形星星
    const fleckCount = Math.round(w * h / 14000);
    for (let i = 0; i < fleckCount; i += 1) {
      const gold = Math.random() < 0.55;
      skyContext.save();
      skyContext.translate(Math.random() * w, random(0, 0.92) * h);
      skyContext.rotate(random(0, Math.PI));
      skyContext.fillStyle = gold
        ? `hsla(${random(38, 52)}, ${random(70, 92)}%, ${random(52, 72)}%, ${random(0.3, 0.85)})`
        : `hsla(${random(196, 216)}, ${random(15, 45)}%, ${random(78, 96)}%, ${random(0.25, 0.7)})`;
      skyContext.beginPath();
      skyContext.ellipse(0, 0, random(1, 5.5), random(0.8, 2.2), 0, 0, Math.PI * 2);
      skyContext.fill();
      skyContext.restore();
    }
  }

  function resize() {
    display.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    display.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    for (const element of [skyCanvas, canvas, catCanvas]) {
      element.width = Math.floor(display.width);
      element.height = Math.floor(display.height);
    }
    paintSky();
    context.clearRect(0, 0, display.width, display.height);
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
    const hue = (baseHue + random(-12, 12) + 360) % 360;
    const base = Math.min(display.width, display.height) * 0.16 * state.size;
    rockets.push({
      x: display.width * random(0.15, 0.85),
      drift: random(-0.03, 0.03) * display.width,
      apexY: display.height * lerp(0.52, 0.14, brightness),
      elapsed: 0,
      base: base * lerp(0.8, 1.25, power),
      power,
      hue,
      fade: 0,
      spin: random(-0.12, 0.12)
    });
  }

  // 一筆顏料：streak 是往外拉的長筆觸，dab 是甩出去的顏料點
  function addStroke(options) {
    strokes.push({
      x: options.x,
      y: options.y,
      vx: options.vx,
      vy: options.vy,
      life: 1,
      decay: options.decay,
      hue: options.hue,
      dab: options.dab === true,
      width: options.width,
      // 每筆記三根鬃毛的偏移，畫出乾筆分岔
      bristles: [
        { offset: random(-1.6, 1.6), scale: random(0.7, 1), alpha: random(0.55, 1) },
        { offset: random(-3.2, 3.2), scale: random(0.4, 0.85), alpha: random(0.25, 0.7) },
        { offset: random(-4.5, 4.5), scale: random(0.25, 0.6), alpha: random(0.15, 0.45) }
      ]
    });
  }

  function burst(rocket, x, y) {
    const scale = Math.min(display.width, display.height) * 0.038 * state.size;
    const rays = Math.round(lerp(11, 22, rocket.power));
    for (let i = 0; i < rays; i += 1) {
      const angle = (i / rays) * Math.PI * 2 + random(-0.14, 0.14);
      // 同一道放射線上疊兩三筆長短不一的筆觸，看起來才像手繪的一撇
      const bunch = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let j = 0; j < bunch; j += 1) {
        const speed = scale * random(0.5, 1.25);
        const spread = random(-0.09, 0.09);
        addStroke({
          x: x + random(-6, 6),
          y: y + random(-6, 6),
          vx: Math.cos(angle + spread) * speed,
          vy: Math.sin(angle + spread) * speed,
          decay: random(0.05, 0.1),
          hue: (rocket.hue + random(-10, 10) + 360) % 360,
          width: random(2, 6) * clamp(state.size, 0.6, 1.6)
        });
      }
      // 撇尾甩出去的顏料點
      if (Math.random() < 0.55) {
        const speed = scale * random(1.1, 1.7);
        addStroke({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          decay: random(0.03, 0.06),
          hue: (rocket.hue + random(-14, 14) + 360) % 360,
          dab: true,
          width: random(2.5, 6) * clamp(state.size, 0.6, 1.6)
        });
      }
    }
  }

  function step() {
    while (pending.length) {
      const item = pending.shift();
      launch(item.power, item.brightness);
    }

    for (let i = rockets.length - 1; i >= 0; i -= 1) {
      const rocket = rockets[i];
      // 綻放後貓咪不是瞬間消失，再留三格淡出
      if (rocket.fade > 0) {
        rocket.fade -= 1;
        if (rocket.fade === 0) {
          rockets.splice(i, 1);
        }
        continue;
      }
      rocket.elapsed += STEP_MS;
      const progress = rocket.elapsed / RISE_MS;
      if (progress >= 1) {
        burst(rocket, rocket.x + rocket.drift, rocket.apexY);
        rocket.fade = 3;
        continue;
      }
      // 上升時每格滴幾筆尾巴
      if (Math.random() < 0.8) {
        const eased = 1 - Math.pow(1 - progress, 2.1);
        const y = lerp(display.height + rocket.base * 0.6, rocket.apexY, eased);
        addStroke({
          x: rocket.x + rocket.drift * eased + random(-0.25, 0.25) * rocket.base,
          y: y + rocket.base * 0.4,
          vx: random(-1.5, 1.5),
          vy: random(2, 7),
          decay: random(0.1, 0.18),
          hue: rocket.hue,
          width: random(1.5, 4)
        });
      }
    }

    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      stroke.x += stroke.vx;
      stroke.y += stroke.vy;
      stroke.vy += 1.6;
      stroke.vx *= 0.9;
      stroke.vy *= 0.9;
      stroke.life -= stroke.decay;
      if (stroke.life <= 0 || stroke.y > display.height + 60) {
        strokes.splice(i, 1);
      }
    }
  }

  function drawStroke(stroke) {
    const life = clamp(stroke.life, 0, 1);
    const speed = Math.hypot(stroke.vx, stroke.vy);
    const angle = Math.atan2(stroke.vy, stroke.vx);
    // 越亮越靠近爆心：接近白熱，尾端才回到煙火色
    const light = lerp(64, 99, Math.pow(life, 1.6));
    const saturation = lerp(88, 28, Math.pow(life, 2.4));

    context.save();
    context.translate(stroke.x, stroke.y);
    context.rotate(angle);

    if (stroke.dab) {
      context.fillStyle = `hsla(${stroke.hue}, ${saturation}%, ${light}%, ${life * 0.9})`;
      context.beginPath();
      context.ellipse(0, 0, stroke.width * lerp(1.6, 0.9, life), stroke.width * 0.55, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    const length = Math.min(speed * 2.6, 120);
    context.lineCap = "round";
    for (const bristle of stroke.bristles) {
      context.strokeStyle = `hsla(${stroke.hue}, ${saturation}%, ${light}%, ${life * bristle.alpha})`;
      context.lineWidth = stroke.width * bristle.scale;
      context.beginPath();
      context.moveTo(0, bristle.offset * 0.4);
      context.lineTo(-length * bristle.scale, bristle.offset);
      context.stroke();
    }
    context.restore();
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
    tintContext.fillStyle = `hsl(${rocket.hue}, 80%, 64%)`;
    tintContext.globalAlpha = 0.38;
    tintContext.fillRect(0, 0, side, side);
    tintContext.globalAlpha = 1;
    tintContext.globalCompositeOperation = "source-over";

    catContext.save();
    catContext.globalAlpha = rocket.fade > 0 ? rocket.fade / 3 : 1;
    catContext.translate(x, y);
    catContext.rotate(rocket.spin * (1 - eased));
    catContext.shadowColor = `hsla(${rocket.hue}, 85%, 62%, 0.55)`;
    catContext.shadowBlur = size * 0.16;
    catContext.drawImage(tintCanvas, -side / 2, -side / 2, side, side);
    catContext.restore();
  }

  function draw() {
    // 用夜空本身淡回去，殘筆會慢慢化進背景而不是壓成一片死黑
    context.globalAlpha = 0.24;
    context.drawImage(skyCanvas, 0, 0);
    context.globalAlpha = 1;

    for (const stroke of strokes) {
      drawStroke(stroke);
    }

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
