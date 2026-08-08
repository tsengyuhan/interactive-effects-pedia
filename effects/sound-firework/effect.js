(function () {
  "use strict";

  const shell = Shell.init({ id: "sound-firework" });
  // 兩層畫布：火星層靠半透明黑覆蓋留拖尾、貓咪層每格清空才不會糊
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const catCanvas = document.createElement("canvas");
  const catContext = catCanvas.getContext("2d");
  // 取樣用離屏畫布：貓咪影格縮到低解析度，一個像素換一顆剪影碎片
  const sampler = document.createElement("canvas");
  const samplerContext = sampler.getContext("2d", { willReadFrequently: true });
  // 紙張風格用的兩張離屏圖：皺白紙只畫一次，破洞後面透出的循環動畫每格重畫
  const paperCanvas = document.createElement("canvas");
  const paperContext = paperCanvas.getContext("2d");
  const noiseCanvas = document.createElement("canvas");
  const noiseContext = noiseCanvas.getContext("2d");
  const meter = document.createElement("div");

  // 四隻寫實貓，各有一套 6 格連續動作；發射時隨機抽一隻
  const CAT_SETS = ["tabby", "tuxedo", "ragdoll", "siamese"];
  const FRAME_COUNT = 6;
  const SHARD_GRID = 56; // 剪影取樣格數：夠細才散得成點狀雲而不是一塊塊馬賽克
  const SHARD_HOLD = 2; // 剪影定格幾個 step 才散開
  const STEP_MS = 1000 / 12; // 逐格動畫：整套模擬固定跑 12 fps，刻意保留頓挫感
  const RISE_MS = 780;
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
    style: "cat",
    threshold: -34,
    size: 1,
    color: "#ffd166"
  };

  const display = { width: 1, height: 1, animationId: 0, lastStep: 0 };
  const frames = {}; // { tabby: [Image × 6], ... }
  const rockets = [];
  const strokes = [];
  const pending = [];
  const holes = []; // 紙張上的破洞，各自跑「炸開 → 蓋回去成撕裂縫 → 淡出」
  const pencils = []; // 已經畫完的鉛筆軌跡，留在紙上慢慢變淡
  let noiseTick = 0;
  let baseHue = 45;
  let framesReady = false;

  for (const element of [canvas, catCanvas]) {
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
  meter.style.background = "rgba(0, 0, 0, 0.62)";
  meter.style.color = "#f3efe6";
  meter.style.font = "14px/1.45 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  meter.style.backdropFilter = "blur(14px)";

  shell.container.style.background = "#000";
  shell.container.append(canvas, catCanvas, meter);

  shell.addParam({
    type: "select",
    key: "style",
    label: "視覺風格",
    value: state.style,
    options: [
      { value: "cat", label: "貓咪煙火" },
      { value: "paper", label: "紙張破裂煙火" }
    ],
    onChange(value) {
      state.style = value;
    }
  });

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

  // 上升的手感：慢起步 → 中段最快 → 到頂點前收住，才有「衝上去然後停在最高點」的加速度感
  function rise(progress) {
    const p = clamp(progress, 0, 1);
    return p * p * p * (p * (p * 6 - 15) + 10);
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
    for (const element of [canvas, catCanvas]) {
      element.width = Math.floor(display.width);
      element.height = Math.floor(display.height);
    }
    context.clearRect(0, 0, display.width, display.height);
    paintPaper();
  }

  function loadFrames() {
    const total = CAT_SETS.length * FRAME_COUNT;
    let loaded = 0;
    for (const name of CAT_SETS) {
      frames[name] = [];
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        const image = new Image();
        image.onload = () => {
          loaded += 1;
          if (loaded === total) {
            framesReady = true;
          }
        };
        image.onerror = () => {
          shell.showError("貓咪序列圖載入失敗，請確認 frames/ 資料夾內的圖檔完整");
        };
        image.src = `frames/${name}-0${i + 1}.webp`;
        frames[name].push(image);
      }
    }
  }

  function launch(power, brightness) {
    const hue = (baseHue + random(-12, 12) + 360) % 360;
    const base = Math.min(display.width, display.height) * 0.16 * state.size;
    rockets.push({
      x: display.width * random(0.15, 0.85),
      drift: random(-0.03, 0.03) * display.width,
      // 下限留 0.22，洞連同翻起來的紙片才不會被畫面上緣切掉
      apexY: display.height * lerp(0.55, 0.22, brightness),
      elapsed: 0,
      // 小聲跟大聲差到 4 倍以上，音量大小才一眼看得出來
      base: base * lerp(0.42, 1.85, Math.pow(power, 0.8)),
      power,
      hue,
      style: state.style,
      cat: CAT_SETS[Math.floor(Math.random() * CAT_SETS.length)],
      path: state.style === "paper" ? [] : null,
      fade: 0,
      spin: random(-0.12, 0.12)
    });
  }

  // 粒子共用一個陣列，kind 決定物理與畫法：
  // brush 乾筆長筆觸／dab 甩出去的顏料點／shard 貓咪剪影碎片
  function addStroke(options) {
    const kind = options.kind || (options.dab ? "dab" : "brush");
    strokes.push({
      kind,
      x: options.x,
      y: options.y,
      vx: options.vx,
      vy: options.vy,
      life: 1,
      decay: options.decay,
      hue: options.hue,
      width: options.width,
      color: options.color,
      hold: options.hold || 0,
      height: options.height,
      // 乾筆才需要記三根鬃毛的偏移，畫出分岔
      bristles: kind === "brush"
        ? [
            { offset: random(-1.6, 1.6), scale: random(0.7, 1), alpha: random(0.55, 1) },
            { offset: random(-3.2, 3.2), scale: random(0.4, 0.85), alpha: random(0.25, 0.7) },
            { offset: random(-4.5, 4.5), scale: random(0.25, 0.6), alpha: random(0.15, 0.45) }
          ]
        : null
    });
  }

  // 把貓咪影格縮到 SHARD_GRID 解析度，一個不透明像素換一顆帶原色的碎片。
  // 碎片先定格成整面剪影（還看得出五官明暗），hold 結束才向外散開。
  function shatter(rocket, x, y) {
    const set = frames[rocket.cat];
    const image = set && set[FRAME_COUNT - 1];
    if (!image || !image.complete || !image.naturalWidth) {
      return;
    }
    sampler.width = SHARD_GRID;
    sampler.height = SHARD_GRID;
    samplerContext.clearRect(0, 0, SHARD_GRID, SHARD_GRID);
    samplerContext.drawImage(image, 0, 0, SHARD_GRID, SHARD_GRID);
    const data = samplerContext.getImageData(0, 0, SHARD_GRID, SHARD_GRID).data;

    const size = rocket.base;
    const cell = size / SHARD_GRID;
    const speed = Math.min(display.width, display.height) * 0.03 * state.size;
    for (let gy = 0; gy < SHARD_GRID; gy += 1) {
      for (let gx = 0; gx < SHARD_GRID; gx += 1) {
        const i = (gy * SHARD_GRID + gx) * 4;
        if (data[i + 3] < 90) {
          continue;
        }
        const px = x + (gx + 0.5 - SHARD_GRID / 2) * cell;
        const py = y + (gy + 0.5 - SHARD_GRID / 2) * cell;
        const angle = Math.atan2(py - y, px - x) + random(-0.25, 0.25);
        // 離中心越遠飛越快，散開時才保得住貓頭的形
        const reach = Math.hypot(px - x, py - y) / (size * 0.5);
        const push = speed * lerp(0.6, 2.6, clamp(reach, 0, 1)) * random(0.75, 1.35);
        addStroke({
          kind: "shard",
          x: px,
          y: py,
          vx: Math.cos(angle) * push,
          vy: Math.sin(angle) * push - speed * 0.3,
          decay: random(0.09, 0.17),
          hold: SHARD_HOLD,
          hue: rocket.hue,
          width: cell * random(0.9, 1.5),
          height: cell * 1.06, // 定格畫滿格再多一點，格子間才不會留黑縫
          color: `${data[i]}, ${data[i + 1]}, ${data[i + 2]}`
        });
      }
    }
  }

  function burst(rocket, x, y) {
    const scale = Math.min(display.width, display.height) * 0.038 * state.size;
    // 主體已經交給剪影碎片，放射乾筆減量到只留爆開的衝擊感
    const rays = Math.round(lerp(6, 12, rocket.power));
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
      if (rocket.fade > 0) {
        rocket.fade -= 1;
        // 剪影定格結束的那一格才放放射乾筆，順序才是「圖片 → 剪影 → 散開」
        if (rocket.fade === 3 && rocket.style !== "paper") {
          burst(rocket, rocket.x + rocket.drift, rocket.apexY);
        }
        if (rocket.fade === 0) {
          rockets.splice(i, 1);
        }
        continue;
      }
      rocket.elapsed += STEP_MS;
      const progress = rocket.elapsed / RISE_MS;
      if (progress >= 1) {
        if (rocket.style === "paper") {
          punchHole(rocket, rocket.x + rocket.drift, rocket.apexY);
          // 畫過的鉛筆線留在紙上慢慢變淡
          pencils.push({ path: rocket.path, hue: rocket.hue, alpha: 1 });
          rockets.splice(i, 1);
        } else {
          shatter(rocket, rocket.x + rocket.drift, rocket.apexY);
          rocket.fade = SHARD_HOLD + 3;
        }
        continue;
      }
      if (rocket.style === "paper") {
        // 每格記一個點。橫向用低頻擺動而不是純隨機，線才會像手畫的自然彎曲
        const eased = rise(progress);
        rocket.path.push({
          x: rocket.x + rocket.drift * eased
            + Math.sin(progress * 5.5 + rocket.spin * 12) * rocket.base * 0.11 + random(-2, 2),
          y: lerp(display.height + rocket.base * 0.2, rocket.apexY, eased) + random(-2, 2),
          // 重描時的偏移先存起來，不然每格重算會讓畫好的線一直抖
          jx: random(-1, 1),
          jy: random(-1, 1)
        });
        continue;
      }
      // 上升時每格滴幾筆尾巴
      if (Math.random() < 0.8) {
        const eased = rise(progress);
        const y = lerp(display.height + rocket.base * 0.6, rocket.apexY, eased);
        const tailX = rocket.x + rocket.drift * eased + random(-0.25, 0.25) * rocket.base;
        addStroke({
          x: tailX,
          y: y + rocket.base * 0.4,
          vx: random(-1.5, 1.5),
          vy: random(2, 7),
          decay: random(0.1, 0.18),
          hue: rocket.hue,
          width: random(1.5, 4)
        });
      }
    }

    for (let i = holes.length - 1; i >= 0; i -= 1) {
      holes[i].t += 1;
      if (holes[i].t > 16) {
        holes.splice(i, 1);
      }
    }

    for (let i = pencils.length - 1; i >= 0; i -= 1) {
      pencils[i].alpha -= 0.025; // 約 3.3 秒淡掉，連打時畫面才不會積滿線
      if (pencils[i].alpha <= 0) {
        pencils.splice(i, 1);
      }
    }

    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      if (stroke.hold > 0) {
        // 剪影定格：先停在原位不動也不衰減，讓人看清楚是一隻貓
        stroke.hold -= 1;
        continue;
      }
      stroke.x += stroke.vx;
      stroke.y += stroke.vy;
      stroke.vy += stroke.kind === "shard" ? 0.7 : 1.6;
      stroke.vx *= stroke.kind === "shard" ? 0.94 : 0.9;
      stroke.vy *= stroke.kind === "shard" ? 0.94 : 0.9;
      stroke.life -= stroke.decay;
      if (stroke.life <= 0 || stroke.y > display.height + 60) {
        strokes.splice(i, 1);
      }
    }
  }

  function drawStroke(stroke) {
    const life = clamp(stroke.life, 0, 1);

    // 剪影碎片：保留取樣到的原始毛色。定格時是方塊才拼得成完整剪影，
    // 一散開就改畫圓點並縮小，馬上從「馬賽克的貓」變成「一團火花」
    if (stroke.kind === "shard") {
      const radius = stroke.width * lerp(0.26, 0.7, life);
      if (stroke.hold > 0) {
        const cell = stroke.height;
        context.fillStyle = `rgb(${stroke.color})`;
        context.fillRect(stroke.x - cell / 2, stroke.y - cell / 2, cell, cell);
        return;
      }
      // 疊加模式重疊處會爆白，所以 alpha 隨壽命掉得比線性快，散開後才回得到毛色
      context.globalCompositeOperation = "lighter";
      context.fillStyle = `rgba(${stroke.color}, ${Math.pow(life, 1.25) * 0.95})`;
      context.beginPath();
      context.arc(stroke.x, stroke.y, radius, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = "source-over";
      return;
    }

    const speed = Math.hypot(stroke.vx, stroke.vy);
    const angle = Math.atan2(stroke.vy, stroke.vx);
    // 越亮越靠近爆心：接近白熱，尾端才回到煙火色
    const light = lerp(64, 99, Math.pow(life, 1.6));
    const saturation = lerp(88, 28, Math.pow(life, 2.4));

    context.save();
    context.translate(stroke.x, stroke.y);
    context.rotate(angle);

    if (stroke.kind === "dab") {
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

  // ── 紙張破裂煙火 ───────────────────────────────────────────────

  // 皺白紙：成對的暗／亮細帶做出折痕，再灑細顆粒。只在 resize 時畫一次
  function paintPaper() {
    const w = display.width;
    const h = display.height;
    paperCanvas.width = w;
    paperCanvas.height = h;
    paperContext.fillStyle = "#f4f1ea";
    paperContext.fillRect(0, 0, w, h);

    // 方頭筆刷：圓頭粗線會變成一根根膠囊，看起來像棒子不像折痕
    paperContext.lineCap = "butt";
    for (let i = 0; i < 110; i += 1) {
      const x = random(-0.2, 1.2) * w;
      const y = random(-0.2, 1.2) * h;
      const angle = random(0, Math.PI * 2);
      // 折痕要夠長夠寬，尺度小了就變成一堆短棒
      const length = random(h * 0.5, h * 1.6);
      const width = random(40, 170);
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length;
      // 暗面與亮面貼在一起，才有稜線的感覺；對比壓很低，紙才不會髒
      const offset = width * 0.5;
      const nx = Math.cos(angle + Math.PI / 2) * offset;
      const ny = Math.sin(angle + Math.PI / 2) * offset;
      paperContext.lineWidth = width;
      paperContext.strokeStyle = `rgba(148, 143, 132, ${random(0.02, 0.055)})`;
      paperContext.beginPath();
      paperContext.moveTo(x, y);
      paperContext.lineTo(x + dx, y + dy);
      paperContext.stroke();
      paperContext.strokeStyle = `rgba(255, 255, 255, ${random(0.07, 0.2)})`;
      paperContext.beginPath();
      paperContext.moveTo(x + nx, y + ny);
      paperContext.lineTo(x + dx + nx, y + dy + ny);
      paperContext.stroke();
    }

    const grain = Math.round(w * h / 260);
    for (let i = 0; i < grain; i += 1) {
      paperContext.fillStyle = `rgba(90, 86, 78, ${random(0.015, 0.05)})`;
      paperContext.fillRect(Math.random() * w, Math.random() * h, random(0.8, 2), random(0.8, 2));
    }
  }

  // 破洞後面透出的循環動畫：流動色帶 + 掃描線撕裂 + 雜訊，程式生成不用影片檔
  function paintNoise() {
    const s = 240;
    if (noiseCanvas.width !== s) {
      noiseCanvas.width = s;
      noiseCanvas.height = s;
    }
    noiseTick += 1;
    noiseContext.fillStyle = "#05060a";
    noiseContext.fillRect(0, 0, s, s);

    noiseContext.lineCap = "round";
    for (let i = 0; i < 16; i += 1) {
      const phase = noiseTick * 0.07 + i * 0.55;
      noiseContext.strokeStyle = `hsla(${(baseHue + i * 24 + noiseTick * 1.6) % 360}, 95%, 62%, 0.6)`;
      noiseContext.lineWidth = 7 + Math.sin(phase) * 5;
      noiseContext.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const y = s * 0.5 + Math.sin(x * 0.021 + phase) * s * 0.24
          + Math.sin(x * 0.052 - phase * 1.7) * s * 0.08 + (i - 7.5) * 13;
        if (x === 0) {
          noiseContext.moveTo(x, y);
        } else {
          noiseContext.lineTo(x, y);
        }
      }
      noiseContext.stroke();
    }

    // 把自己的一條橫帶往旁邊搬，就是訊號撕裂
    for (let i = 0; i < 22; i += 1) {
      const y = Math.random() * s;
      const band = random(1, 6);
      noiseContext.drawImage(noiseCanvas, 0, y, s, band, random(-16, 16), y, s, band);
    }

    for (let i = 0; i < 380; i += 1) {
      noiseContext.fillStyle = `rgba(255, 255, 255, ${random(0.05, 0.35)})`;
      noiseContext.fillRect(Math.random() * s, Math.random() * s, random(1, 3), random(1, 2));
    }
  }

  // 每個洞的輪廓都不一樣：隨機頂點數與半徑，再各自帶一點角度抖動
  function punchHole(rocket, x, y) {
    const radius = rocket.base * 0.5;
    // 頂點少、邊就長，輪廓才是大致圓潤的破口；每個頂點都加齒會變成齒輪
    const count = Math.round(random(6, 10));
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const span = (Math.PI * 2) / count;
      // 角度抖動要遠小於毛刺的偏移，不然毛刺會越過下一個頂點、路徑自己打結
      const angle = (i / count) * Math.PI * 2 + random(-0.08, 0.08);
      const hasBurr = Math.random() < 0.4; // 只有少數幾段邊撕出尖角
      points.push({
        angle,
        radius: radius * random(0.86, 1.12),
        hasBurr,
        burrAngle: angle + span * random(0.4, 0.6),
        burrRadius: radius * (Math.random() < 0.5 ? random(0.58, 0.74) : random(1.14, 1.32)),
        flap: Math.random() < 0.5, // 只有部分邊翻起紙片，邊緣才不規則
        // 翻捲片的形狀要在這裡定好，每格重算會讓紙片抖動
        lift: random(1.14, 1.3),
        bulge: random(1.02, 1.14)
      });
    }
    holes.push({ x, y, radius, points, tilt: random(0, Math.PI), t: 0 });
  }

  // 洞的四個階段（單位是 step，12fps）：炸開 → 撐著 → 蓋回去 → 撕裂縫淡出
  function holePhase(hole) {
    if (hole.t < 2) {
      return { open: hole.t / 2, seam: 1 };
    }
    if (hole.t < 7) {
      return { open: 1, seam: 1 };
    }
    if (hole.t < 11) {
      return { open: 1 - (hole.t - 7) / 4, seam: 1 };
    }
    return { open: 0, seam: clamp(1 - (hole.t - 11) / 5, 0, 1) };
  }

  // 直線相連才留得住撕裂的尖角；圓滑曲線會把邊磨成花瓣
  function tracePath(hole) {
    context.beginPath();
    for (let i = 0; i < hole.points.length; i += 1) {
      const point = hole.points[i];
      const px = Math.cos(point.angle) * point.radius;
      const py = Math.sin(point.angle) * point.radius;
      if (i === 0) {
        context.moveTo(px, py);
      } else {
        context.lineTo(px, py);
      }
      if (point.hasBurr) {
        context.lineTo(Math.cos(point.burrAngle) * point.burrRadius, Math.sin(point.burrAngle) * point.burrRadius);
      }
    }
    context.closePath();
  }

  function drawHole(hole) {
    const phase = holePhase(hole);
    const radius = hole.radius;
    // 蓋回去時沿短軸壓扁，洞自然收成一條撕裂縫
    const squash = Math.max(0.025, phase.open);

    context.save();
    context.globalAlpha = phase.seam;
    context.translate(hole.x, hole.y);
    context.rotate(hole.tilt);
    context.scale(1, squash);

    // 先用帶模糊的填色打底，外溢的部分就是洞在紙上的落影
    context.save();
    context.shadowColor = "rgba(60, 55, 48, 0.5)";
    context.shadowBlur = radius * 0.4;
    context.shadowOffsetY = radius * 0.08;
    context.fillStyle = "#2a2a2e";
    tracePath(hole);
    context.fill();
    context.restore();

    // 洞裡透出循環動畫，邊緣再壓一圈內陰影做出往內的深度
    context.save();
    tracePath(hole);
    context.clip();
    context.drawImage(noiseCanvas, -radius * 1.25, -radius * 1.25, radius * 2.5, radius * 2.5);
    context.shadowColor = "rgba(0, 0, 0, 0.9)";
    context.shadowBlur = radius * 0.5;
    context.strokeStyle = "rgba(0, 0, 0, 0.8)";
    context.lineWidth = radius * 0.12;
    tracePath(hole);
    context.stroke();
    context.restore();

    // 沿邊翻起來的紙片：白色舌狀，帶落影才立體
    context.shadowColor = "rgba(60, 55, 48, 0.45)";
    context.shadowBlur = radius * 0.14;
    context.shadowOffsetY = radius * 0.05;
    for (let i = 0; i < hole.points.length; i += 1) {
      const a = hole.points[i];
      if (!a.flap) {
        continue;
      }
      const b = hole.points[(i + 1) % hole.points.length];
      const ax = Math.cos(a.angle) * a.radius;
      const ay = Math.sin(a.angle) * a.radius;
      const bx = Math.cos(b.angle) * b.radius;
      const by = Math.sin(b.angle) * b.radius;
      // 兩端各沿自己的角度往外推，翻起來的紙片必定落在洞外，不會凹進洞裡
      const outAx = Math.cos(a.angle) * a.radius * a.lift;
      const outAy = Math.sin(a.angle) * a.radius * a.lift;
      const outBx = Math.cos(b.angle) * b.radius * a.lift;
      const outBy = Math.sin(b.angle) * b.radius * a.lift;
      const gradient = context.createLinearGradient(ax, ay, outAx, outAy);
      gradient.addColorStop(0, "rgba(196, 192, 182, 0.95)");
      gradient.addColorStop(1, "#fdfcf8");
      context.fillStyle = gradient;
      // 外緣用曲線收邊，翻起來的紙片才是圓鈍的舌狀而不是尖角
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(outAx, outAy);
      context.quadraticCurveTo(((outAx + outBx) / 2) * a.bulge, ((outAy + outBy) / 2) * a.bulge, outBx, outBy);
      context.lineTo(bx, by);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  // 同一條路徑重描好幾遍、每遍偏移一點，疊出手繪的毛邊
  function strokePath(path, wobble) {
    context.beginPath();
    context.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i += 1) {
      context.lineTo(path[i].x + path[i].jx * wobble, path[i].y + path[i].jy * wobble);
    }
    context.stroke();
  }

  // 鉛筆壓在紙紋上留下的碎點。跟著線段一起生成並存起來，畫面上才不會每格閃爍
  function buildGrain(path) {
    if (!path.grain) {
      path.grain = [];
      path.grainBuilt = 1;
    }
    while (path.grainBuilt < path.length) {
      const i = path.grainBuilt;
      for (let j = 0; j < 5; j += 1) {
        const amount = Math.random();
        path.grain.push({
          x: lerp(path[i - 1].x, path[i].x, amount) + random(-5, 5),
          y: lerp(path[i - 1].y, path[i].y, amount) + random(-5, 5),
          size: random(0.8, 2.4),
          alpha: random(0.15, 0.5)
        });
      }
      path.grainBuilt += 1;
    }
  }

  // 鉛筆／色鉛筆線：主線抖一點，沿線再灑顆粒，才不像向量直線
  function drawPencil(path, hue, alpha) {
    if (path.length < 2) {
      return;
    }
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    // 參考圖的筆桿就是一根深灰鉛筆，加色暈只會讓它看起來像電線
    context.strokeStyle = `rgba(96, 93, 90, ${alpha * 0.45})`;
    context.lineWidth = 11;
    strokePath(path, 3.5);
    context.strokeStyle = `rgba(64, 62, 60, ${alpha * 0.7})`;
    context.lineWidth = 7.5;
    strokePath(path, 1.6);
    context.strokeStyle = `rgba(38, 36, 34, ${alpha * 0.92})`;
    context.lineWidth = 4;
    strokePath(path, 0);

    buildGrain(path);
    for (const dot of path.grain) {
      context.fillStyle = `rgba(48, 46, 44, ${alpha * dot.alpha})`;
      context.fillRect(dot.x, dot.y, dot.size, dot.size);
    }
    context.restore();
  }

  function drawPaperScene() {
    context.drawImage(paperCanvas, 0, 0);
    for (const pencil of pencils) {
      drawPencil(pencil.path, pencil.hue, pencil.alpha);
    }
    for (const rocket of rockets) {
      if (rocket.fade === 0 && rocket.path) {
        drawPencil(rocket.path, rocket.hue, 1);
      }
    }
    paintNoise();
    for (const hole of holes) {
      drawHole(hole);
    }
  }

  function drawCat(rocket) {
    const progress = clamp(rocket.elapsed / RISE_MS, 0, 1);
    const eased = rise(progress);
    const frameIndex = Math.min(FRAME_COUNT - 1, Math.floor(progress * FRAME_COUNT));
    const set = frames[rocket.cat];
    const image = set && set[frameIndex];
    if (!image || !image.complete || !image.naturalWidth) {
      return;
    }

    const size = rocket.base * lerp(0.4, 1, eased);
    const x = rocket.x + rocket.drift * eased;
    const y = lerp(display.height + size * 0.6, rocket.apexY, eased);
    const side = Math.max(2, Math.round(size));

    // 不染色，寫實毛色要看得出品種；只靠煙火色的外暈把貓咪接回畫面
    catContext.save();
    catContext.translate(x, y);
    catContext.rotate(rocket.spin * (1 - eased));
    catContext.shadowColor = `hsla(${rocket.hue}, 85%, 62%, 0.8)`;
    catContext.shadowBlur = size * 0.26;
    catContext.drawImage(image, -side / 2, -side / 2, side, side);
    catContext.restore();
  }

  function draw() {
    catContext.clearRect(0, 0, display.width, display.height);

    if (state.style === "paper") {
      // 紙張要保持乾淨，不做拖尾，每格整張重畫
      drawPaperScene();
      return;
    }

    // 半透明黑覆蓋，殘筆化成拖尾慢慢沉回黑底
    context.fillStyle = "rgba(0, 0, 0, 0.26)";
    context.fillRect(0, 0, display.width, display.height);

    for (const stroke of strokes) {
      drawStroke(stroke);
    }

    for (const rocket of rockets) {
      // 炸開後主體就交給粒子，不再畫升空中的貓
      if (rocket.fade === 0) {
        drawCat(rocket);
      }
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
      `<div style="color:rgba(243,239,230,.75);font-size:12px">紅線是觸發音量，超過就發射一發煙火</div>`
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
