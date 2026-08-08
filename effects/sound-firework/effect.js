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
  // 紙張風格用的三張離屏圖：紙只畫一次；鉛筆痕跡累積在自己那層慢慢淡掉；
  // 破洞後面的流動動畫每格重畫，而且是整片全螢幕的，洞只是遮罩
  const paperCanvas = document.createElement("canvas");
  const paperContext = paperCanvas.getContext("2d");
  const pencilCanvas = document.createElement("canvas");
  const pencilContext = pencilCanvas.getContext("2d");
  const flowCanvas = document.createElement("canvas");
  const flowContext = flowCanvas.getContext("2d");
  // 合成用：先用破口遮罩把流動圖剪成洞的形狀，再貼到畫面上
  const tearCanvas = document.createElement("canvas");
  const tearContext = tearCanvas.getContext("2d");
  const meter = document.createElement("div");

  // 四隻寫實貓，各有一套 6 格連續動作；發射時隨機抽一隻
  const CAT_SETS = ["tabby", "tuxedo", "ragdoll", "siamese"];
  const FRAME_COUNT = 6;
  // 四種撕法，各一套 6 格從小撕到大的序列圖；發射時隨機抽一組
  const TEAR_SETS = ["a", "b", "c", "d"];
  const TEAR_FRAMES = 6;
  const TEAR_HOLD = 3; // 撕到最大後撐幾格才倒放合回去
  const TEAR_TMP = 512; // 合成用畫布邊長
  const SHARD_GRID = 56; // 剪影取樣格數：夠細才散得成點狀雲而不是一塊塊馬賽克
  const SHARD_HOLD = 1; // 剪影只定格一格：看得出是貓就好，多一格就變成暫停
  const STEP_MS = 1000 / 12; // 逐格動畫：整套模擬固定跑 12 fps，刻意保留頓挫感
  const RISE_MS = 520; // 往上衝的爆發感，慢了就沒有煙火的勁
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
  const tears = {}; // { a: [{ image, mask } × 6], ... }
  const rockets = [];
  const strokes = [];
  const pending = [];
  const holes = []; // 紙張上的破洞，各自跑「撕開 → 撐著 → 倒放合回去」
  let flowTick = 0;
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

  // 上升的手感：慢起步 → 中段最快 → 到頂點前收住。
  // 用 smoothstep 而不是更陡的 smootherstep，後者尾段幾乎靜止，看起來像突然按了暫停
  function rise(progress) {
    const p = clamp(progress, 0, 1);
    return p * p * (3 - 2 * p);
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
    const total = CAT_SETS.length * FRAME_COUNT + TEAR_SETS.length * TEAR_FRAMES * 2;
    let loaded = 0;
    const track = (image, src) => {
      image.onload = () => {
        loaded += 1;
        if (loaded === total) {
          framesReady = true;
        }
      };
      image.onerror = () => {
        shell.showError("序列圖載入失敗，請確認 frames/ 資料夾內的圖檔完整");
      };
      image.src = src;
    };

    for (const name of CAT_SETS) {
      frames[name] = [];
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        const image = new Image();
        track(image, `frames/${name}-0${i + 1}.webp`);
        frames[name].push(image);
      }
    }

    for (const name of TEAR_SETS) {
      tears[name] = [];
      for (let i = 0; i < TEAR_FRAMES; i += 1) {
        const image = new Image();
        const mask = new Image();
        track(image, `frames/tear-${name}-0${i + 1}.webp`);
        track(mask, `frames/tear-${name}-0${i + 1}-m.webp`);
        tears[name].push({ image, mask });
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
      last: null, // 紙張風格用：上一格的鉛筆落點
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
          // 撐久一點：粒子數量不變、只是越散越開，才看得到密集炸成稀疏的過程
          decay: random(0.04, 0.072),
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
    const scale = Math.min(display.width, display.height) * 0.055 * state.size;
    // 收尾的煙火線條，數量不多但要拉得夠開才看得到
    const rays = Math.round(lerp(9, 16, rocket.power));
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
        // 等粒子散開幾格之後才放放射乾筆，順序才是「貓 → 粒子 → 炸開 → 煙火線條」
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
          rockets.splice(i, 1);
        } else {
          shatter(rocket, rocket.x + rocket.drift, rocket.apexY);
          rocket.fade = SHARD_HOLD + 6;
        }
        continue;
      }
      if (rocket.style === "paper") {
        // 橫向用低頻擺動而不是純隨機，線才會像手畫的自然彎曲。
        // 每格只把新的那一段撒進鉛筆層，畫過的部分就固定在紙上了
        const eased = rise(progress);
        const point = {
          x: rocket.x + rocket.drift * eased
            + Math.sin(progress * 5.5 + rocket.spin * 12) * rocket.base * 0.11 + random(-1.5, 1.5),
          y: lerp(display.height + rocket.base * 0.2, rocket.apexY, eased) + random(-1.5, 1.5)
        };
        if (rocket.last) {
          inkPencil(rocket.last, point, rocket.hue);
        }
        rocket.last = point;
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
      // 撕開 6 格 + 撐 TEAR_HOLD 格 + 倒放 6 格
      if (holes[i].t >= TEAR_FRAMES * 2 + TEAR_HOLD) {
        holes.splice(i, 1);
      }
    }

    // 整層鉛筆痕跡一起變淡：擦掉一點點就好，約 3 秒退乾淨
    if (state.style === "paper") {
      pencilContext.globalCompositeOperation = "destination-out";
      pencilContext.fillStyle = "rgba(0, 0, 0, 0.035)";
      pencilContext.fillRect(0, 0, display.width, display.height);
      pencilContext.globalCompositeOperation = "source-over";
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
      // 大半輩子維持滿亮度、最後才快速淡掉，粒子數量看起來才是不變的
      context.globalCompositeOperation = "lighter";
      context.fillStyle = `rgba(${stroke.color}, ${Math.min(1, life * 2.6) * 0.92})`;
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

  // 一般的紙張質感：米白底、細顆粒、幾道很淡的纖維，不要折痕線條
  function paintPaper() {
    const w = display.width;
    const h = display.height;
    paperCanvas.width = w;
    paperCanvas.height = h;
    pencilCanvas.width = w;
    pencilCanvas.height = h;
    paperContext.fillStyle = "#f2efe8";
    paperContext.fillRect(0, 0, w, h);

    // 大範圍、極低對比的明暗不均，紙才不會像一塊死板的色塊
    for (let i = 0; i < 7; i += 1) {
      const cx = random(0, w);
      const cy = random(0, h);
      const r = random(w * 0.3, w * 0.9);
      const gradient = paperContext.createRadialGradient(cx, cy, 0, cx, cy, r);
      const dark = Math.random() < 0.5;
      gradient.addColorStop(0, dark ? "rgba(150, 145, 134, 0.05)" : "rgba(255, 255, 255, 0.5)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      paperContext.fillStyle = gradient;
      paperContext.fillRect(0, 0, w, h);
    }

    // 紙纖維：很短、很淡的細線，方向隨機
    paperContext.lineWidth = 1;
    for (let i = 0; i < 900; i += 1) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const angle = random(0, Math.PI * 2);
      const length = random(3, 14);
      paperContext.strokeStyle = Math.random() < 0.5
        ? `rgba(160, 154, 142, ${random(0.03, 0.09)})`
        : `rgba(255, 255, 255, ${random(0.2, 0.5)})`;
      paperContext.beginPath();
      paperContext.moveTo(x, y);
      paperContext.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      paperContext.stroke();
    }

    const grain = Math.round(w * h / 90);
    for (let i = 0; i < grain; i += 1) {
      paperContext.fillStyle = Math.random() < 0.55
        ? `rgba(120, 115, 105, ${random(0.02, 0.07)})`
        : `rgba(255, 255, 255, ${random(0.1, 0.35)})`;
      paperContext.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  }

  // 洞後面透出的循環動畫：全息大理石的流動。整片鋪滿畫面、和洞無關，
  // 洞只是把它露出來的遮罩，所以洞變大變小時後面的畫面不會跟著縮放。
  function paintFlow() {
    // 破口只露出這張圖的一小塊，解析度不夠的話紋理會變成幾片色塊
    const w = 480;
    const h = 600;
    if (flowCanvas.width !== w) {
      flowCanvas.width = w;
      flowCanvas.height = h;
    }
    flowTick += 1;
    const time = flowTick * 0.024;

    // 底色壓深一點，貼在白紙上的破口才有對比、才看得出是「後面另有一層」
    flowContext.fillStyle = "#a2a8b5";
    flowContext.fillRect(0, 0, w, h);
    flowContext.lineCap = "round";

    // 帶要夠密，不然洞只露出全螢幕的一小塊、裡面看起來會太空
    const bands = 78;
    for (let i = 0; i < bands; i += 1) {
      const phase = time + i * 0.62;
      // 用三角函數決定每條帶的粗細與色相，不能用 random，不然每格會閃
      const wobble = Math.sin(phase * 1.7);
      const baseY = (i / bands) * (h + 120) - 60;
      const trace = (offset) => {
        flowContext.beginPath();
        for (let x = -24; x <= w + 24; x += 9) {
          const y = baseY + offset
            + Math.sin(x * 0.0135 + phase) * 36
            + Math.sin(x * 0.0312 - phase * 1.6) * 15
            + Math.sin(x * 0.0071 + phase * 0.4) * 22;
          if (x === -24) {
            flowContext.moveTo(x, y);
          } else {
            flowContext.lineTo(x, y);
          }
        }
        flowContext.stroke();
      };

      // 珍珠白主帶。帶要夠寬，細線條會變成一條條的線而不是流動的塊面
      flowContext.strokeStyle = `hsla(${(baseHue + i * 7 + flowTick * 0.6) % 360}, ${14 + wobble * 10}%, ${86 + wobble * 8}%, 0.92)`;
      flowContext.lineWidth = 17 + wobble * 8;
      trace(0);
      // 黑色深溝壓在帶的下緣，是這種大理石紋的骨架，不夠深整片就糊成灰
      flowContext.strokeStyle = `rgba(16, 16, 24, ${0.72 + wobble * 0.2})`;
      flowContext.lineWidth = 3.2 + Math.sin(phase * 2.3) * 2;
      trace(7 + wobble * 2);
      // 虹光：溝的另一側帶一道青／粉／綠的細邊
      flowContext.strokeStyle = `hsla(${(baseHue + i * 47 + flowTick * 2) % 360}, 95%, 72%, 0.42)`;
      flowContext.lineWidth = 1.8 + Math.sin(phase * 1.1) * 1.2;
      trace(-5 - wobble * 2);
    }
  }

  // 撕開的破口用序列圖播放：程式畫的多邊形怎麼調都不夠自然。
  // 一組 6 格從小撕到大，撐幾格之後原樣倒放合回去。
  function punchHole(rocket, x, y) {
    holes.push({
      x,
      y,
      size: rocket.base * 1.6, // 貼片邊長；破口約佔貼片的七成
      set: TEAR_SETS[Math.floor(Math.random() * TEAR_SETS.length)],
      t: 0
    });
  }

  function tearIndex(hole) {
    if (hole.t < TEAR_FRAMES) {
      return hole.t;
    }
    if (hole.t < TEAR_FRAMES + TEAR_HOLD) {
      return TEAR_FRAMES - 1;
    }
    return TEAR_FRAMES - 1 - (hole.t - TEAR_FRAMES - TEAR_HOLD);
  }

  function drawHole(hole) {
    const index = tearIndex(hole);
    const set = tears[hole.set];
    const item = index >= 0 && set ? set[index] : null;
    if (!item || !item.image.complete || !item.mask.complete) {
      return;
    }
    const size = hole.size;
    const dx = hole.x - size / 2;
    const dy = hole.y - size / 2;

    // 破口遮罩剪出洞形，再用 source-in 把流動圖填進去。取的是畫面上同一塊區域，
    // 所以洞怎麼開合，後面的影像都不動——就像前面蓋著一張紙
    if (tearCanvas.width !== TEAR_TMP) {
      tearCanvas.width = TEAR_TMP;
      tearCanvas.height = TEAR_TMP;
    }
    tearContext.clearRect(0, 0, TEAR_TMP, TEAR_TMP);
    tearContext.drawImage(item.mask, 0, 0, TEAR_TMP, TEAR_TMP);
    tearContext.globalCompositeOperation = "source-in";
    tearContext.drawImage(
      flowCanvas,
      (dx / display.width) * flowCanvas.width,
      (dy / display.height) * flowCanvas.height,
      (size / display.width) * flowCanvas.width,
      (size / display.height) * flowCanvas.height,
      0,
      0,
      TEAR_TMP,
      TEAR_TMP
    );
    tearContext.globalCompositeOperation = "source-over";

    context.drawImage(tearCanvas, dx, dy, size, size);
    context.drawImage(item.image, dx, dy, size, size);
  }


  // 鉛筆筆跡：沿路徑密集撒碳粉顆粒，中間密邊緣稀。
  // 直接畫進鉛筆層並且只畫新的那一段，既不會每格重算而抖動，也不用重畫整條線
  function inkPencil(from, to, hue) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const nx = -dy / (length || 1);
    const ny = dx / (length || 1);
    const steps = Math.max(2, Math.round(length / 1.2));

    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;
      for (let j = 0; j < 11; j += 1) {
        // 用兩個亂數相加逼近常態分布，顆粒才會集中在筆芯中央
        const spread = (Math.random() + Math.random() - 1) * 5.5;
        const fade = 1 - Math.abs(spread) / 5.5;
        pencilContext.fillStyle = `rgba(46, 44, 42, ${0.16 + fade * 0.5})`;
        pencilContext.fillRect(cx + nx * spread, cy + ny * spread, 1, 1);
      }
      // 偶爾壓重一點，鉛筆的深淺才有變化
      if (Math.random() < 0.22) {
        pencilContext.fillStyle = `hsla(${hue}, 30%, 22%, 0.5)`;
        pencilContext.fillRect(cx + nx * random(-1.4, 1.4), cy + ny * random(-1.4, 1.4), random(1, 2.2), random(1, 2.2));
      }
    }
  }

  function drawPaperScene() {
    context.drawImage(paperCanvas, 0, 0);
    context.drawImage(pencilCanvas, 0, 0);
    paintFlow();
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
