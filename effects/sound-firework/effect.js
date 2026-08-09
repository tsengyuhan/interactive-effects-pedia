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
  // 流體背景是每個像素各自算的（域變形雜訊），Canvas 2D 在 12fps 下跑不動，
  // 所以這一層改用 WebGL 跑一支 fragment shader。preserveDrawingBuffer 讓它能安全地
  // 被 drawImage 當成來源圖
  const flowCanvas = document.createElement("canvas");
  const gl = flowCanvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false });
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
  const TEAR_HOLD = 2; // 撕到最大後撐幾格才倒放合回去
  const TEAR_SPEED = 1.6; // 序列圖播放倍速：撕開與合回去都比逐格快，破口才有炸開的乾脆感
  const TEAR_TMP = 512; // 合成用畫布邊長
  const SHARD_GRID = 56; // 剪影取樣格數：夠細才散得成點狀雲而不是一塊塊馬賽克
  const BLOOM_STEPS = 4; // 綻放期長度：照片放大淡出、粒子剪影同步放大淡入，兩者交疊才不會原地硬切
  const BLOOM_SCALE = 1.3; // 綻放期把照片與剪影一起放大到這個倍率，再交給輪廓繼續脹大
  const RIM_BINS = 96; // 量貓頭輪廓半徑用的角度格數
  const RIM_SCALE = 1.55; // 輪廓放大倍率：剪影炸開後粒子圍成的貓頭要比原本大
  const RIM_STEPS = 3; // 從剪影聚到輪廓花幾格
  const STEP_MS = 1000 / 12; // 逐格動畫：整套模擬固定跑 12 fps，刻意保留頓挫感
  const RISE_MS = 520; // 往上衝的爆發感，慢了就沒有煙火的勁
  const PAPER_RISE_MS = 170; // 鉛筆線是一記快甩，比貓咪更短更急
  const PAPER_SUBSTEPS = 4; // 一格拆成四小段畫，線甩得再快也不會斷成折線
  const MAX_DPR = 2; // 畫布跟著螢幕像素密度放大，不然高 DPI 螢幕上整層會被瀏覽器拉伸糊掉；
  // 封在 2 是因為粒子數以千計，再高就開始掉格
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

  const display = { width: 1, height: 1, dpr: 1, animationId: 0, lastStep: 0 };
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
      { value: "paper", label: "紙張破裂煙火" },
      { value: "flow", label: "只看背景動態" }
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

  // 鉛筆的甩勁：起手就是最快，尾段才收住。用 smoothstep 會慢慢起步，看起來像在描不像在甩
  function flick(progress) {
    const p = clamp(progress, 0, 1);
    return 1 - Math.pow(1 - p, 2.4);
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

  // 所有全螢幕畫布都用「實際像素當底、CSS 像素當座標」：backing store 乘上 dpr，
  // 再用 setTransform 把座標系縮回 CSS 像素，畫圖的程式碼完全不用改
  function sizeCanvas(element, ctx) {
    element.width = Math.floor(display.width * display.dpr);
    element.height = Math.floor(display.height * display.dpr);
    ctx.setTransform(display.dpr, 0, 0, display.dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
  }

  function resize() {
    display.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    display.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    display.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    sizeCanvas(canvas, context);
    sizeCanvas(catCanvas, catContext);
    context.clearRect(0, 0, display.width, display.height);
    paintPaper();
  }

  function loadFrames() {
    // 貓咪序列圖沒到就整個跑不動，所以只有它會擋住開始並跳錯誤
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

    // 撕紙序列圖只有紙張風格會用到，載不到就那一組不畫，不該把整個效果拖垮
    for (const name of TEAR_SETS) {
      tears[name] = [];
      for (let i = 0; i < TEAR_FRAMES; i += 1) {
        const image = new Image();
        const mask = new Image();
        image.src = `frames/tear-${name}-0${i + 1}.webp`;
        mask.src = `frames/tear-${name}-0${i + 1}-m.webp`;
        tears[name].push({ image, mask });
      }
    }
  }

  function launch(power, brightness) {
    if (state.style === "flow") {
      return; // 只看背景動態時不發射，畫面就純粹是那層流動
    }
    // 紙張是色鉛筆：色相切成 12 支筆去抽，而不是 0~360 連續亂數——
    // 連續亂數常常抽到相鄰的色相，兩發看起來就像同一支筆
    const hue = state.style === "paper"
      ? (Math.floor(Math.random() * 12) * 30 + random(-7, 7) + 360) % 360
      : (baseHue + random(-12, 12) + 360) % 360;
    const base = Math.min(display.width, display.height) * 0.16 * state.size;
    rockets.push({
      x: display.width * random(0.15, 0.85),
      drift: random(-0.03, 0.03) * display.width,
      // 下限留 0.3，破口變大之後連同紙片才不會被畫面上緣切掉
      apexY: display.height * lerp(0.6, 0.3, brightness),
      elapsed: 0,
      // 小聲跟大聲差到 4 倍以上，音量大小才一眼看得出來
      base: base * lerp(0.42, 1.85, Math.pow(power, 0.8)),
      power,
      hue,
      style: state.style,
      riseMs: state.style === "paper" ? PAPER_RISE_MS : RISE_MS,
      cat: CAT_SETS[Math.floor(Math.random() * CAT_SETS.length)],
      // 筆芯粗細：一半維持原本的細筆，另一半抽一支明顯更粗的，畫面才有輕重變化
      nib: Math.random() < 0.5 ? 1 : random(1.5, 2.6),
      last: null, // 紙張風格用：上一格的鉛筆落點
      fade: 0,
      spin: random(-0.12, 0.12)
    });
  }

  // 現在只剩貓咪的剪影碎片一種粒子；乾筆與顏料點隨著煙火線條一起拿掉了
  function addStroke(options) {
    strokes.push({
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
      holdTotal: options.hold || 0,
      height: options.height,
      // 綻放期：剪影從照片原尺寸一起脹到 BLOOM_SCALE，同時淡入接手照片
      bloom: 0,
      bloomX: options.bloomX,
      bloomY: options.bloomY,
      // 剪影 → 輪廓那一段：從原位聚到輪廓上，聚攏期間不衰減也不受重力
      gather: options.gather || 0,
      gatherTotal: options.gather || 0,
      ox: options.x,
      oy: options.y,
      rimX: options.rimX,
      rimY: options.rimY
    });
  }

  // 把貓咪影格縮到 SHARD_GRID 解析度，一個不透明像素換一顆帶原色的碎片。
  // 三段：邊放大邊從照片淡接成剪影 → 全部聚到更大的貓頭輪廓上 → 才向外散開。
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

    // 先量出每個角度上貓頭最外緣的半徑，這條輪廓就是粒子聚攏的目標
    const rim = new Float32Array(RIM_BINS);
    for (let gy = 0; gy < SHARD_GRID; gy += 1) {
      for (let gx = 0; gx < SHARD_GRID; gx += 1) {
        if (data[(gy * SHARD_GRID + gx) * 4 + 3] < 90) {
          continue;
        }
        const ux = gx + 0.5 - SHARD_GRID / 2;
        const uy = gy + 0.5 - SHARD_GRID / 2;
        const bin = Math.floor(((Math.atan2(uy, ux) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RIM_BINS);
        rim[bin] = Math.max(rim[bin], Math.hypot(ux, uy));
      }
    }
    // 只跟左右鄰居取平均，補掉零星的空角度。取最大值會把耳朵旁邊的凹陷一起抬平，
    // 輪廓就變成一個橢圓、看不出是貓頭了
    const smooth = new Float32Array(RIM_BINS);
    for (let i = 0; i < RIM_BINS; i += 1) {
      const prev = rim[(i - 1 + RIM_BINS) % RIM_BINS];
      const next = rim[(i + 1) % RIM_BINS];
      smooth[i] = rim[i] > 0 ? (prev + rim[i] * 2 + next) / 4 : (prev + next) / 2;
    }

    const size = rocket.base;
    const cell = size / SHARD_GRID;
    const speed = Math.min(display.width, display.height) * 0.03 * state.size;
    for (let gy = 0; gy < SHARD_GRID; gy += 1) {
      for (let gx = 0; gx < SHARD_GRID; gx += 1) {
        const i = (gy * SHARD_GRID + gx) * 4;
        if (data[i + 3] < 90) {
          continue;
        }
        const ux = gx + 0.5 - SHARD_GRID / 2;
        const uy = gy + 0.5 - SHARD_GRID / 2;
        const px = x + ux * cell;
        const py = y + uy * cell;
        const theta = Math.atan2(uy, ux);
        const bin = Math.floor(((theta + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RIM_BINS);
        // 輪廓上帶一點厚度，不然幾千顆粒子會擠成一條死板的細線
        const rimRadius = smooth[bin] * cell * RIM_SCALE * random(0.93, 1.08);
        const angle = theta + random(-0.16, 0.16);
        const push = speed * random(1.1, 2.1);
        addStroke({
          x: px,
          y: py,
          bloomX: x + ux * cell * BLOOM_SCALE,
          bloomY: y + uy * cell * BLOOM_SCALE,
          rimX: x + Math.cos(theta) * rimRadius,
          rimY: y + Math.sin(theta) * rimRadius,
          gather: RIM_STEPS,
          vx: Math.cos(angle) * push,
          vy: Math.sin(angle) * push - speed * 0.3,
          // 撐久一點：粒子數量不變、只是越散越開，才看得到密集炸成稀疏的過程
          decay: random(0.04, 0.072),
          hold: BLOOM_STEPS,
          hue: rocket.hue,
          width: cell * random(0.9, 1.5),
          height: cell * 1.06, // 定格畫滿格再多一點，格子間才不會留黑縫
          color: `${data[i]}, ${data[i + 1]}, ${data[i + 2]}`
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
        if (rocket.fade === 0) {
          rockets.splice(i, 1);
        }
        continue;
      }
      rocket.elapsed += STEP_MS;
      const progress = rocket.elapsed / rocket.riseMs;
      if (progress >= 1) {
        if (rocket.style === "paper") {
          // 補上最後一段收到頂點，破口才不會浮在筆跡上方
          if (rocket.last) {
            inkPencil(rocket.last, { x: rocket.x + rocket.drift, y: rocket.apexY }, rocket.hue, 0.45, rocket.nib);
          }
          punchHole(rocket, rocket.x + rocket.drift, rocket.apexY);
          rockets.splice(i, 1);
        } else {
          // 粒子先出來，照片再花 BLOOM_STEPS 格邊放大邊淡出交棒，中間不留空檔
          shatter(rocket, rocket.x + rocket.drift, rocket.apexY);
          rocket.fade = BLOOM_STEPS;
          rocket.tailFrom = null; // 尾巴停在頂點，別再逐格重畫同一段燒成亮斑
        }
        continue;
      }
      if (rocket.style === "paper") {
        // 一格拆成幾小段畫：線甩得快，但擺動的彎曲還是留得住。
        // 每格只把新的那幾段撒進鉛筆層，畫過的部分就固定在紙上了
        if (!rocket.last) {
          rocket.last = pencilPoint(rocket, 0); // 從畫面最底下起筆，不留空白
        }
        const from = (rocket.elapsed - STEP_MS) / rocket.riseMs;
        for (let s = 1; s <= PAPER_SUBSTEPS; s += 1) {
          const p = clamp(lerp(from, progress, s / PAPER_SUBSTEPS), 0, 1);
          const point = pencilPoint(rocket, p);
          // 越往上筆壓越輕，收出筆鋒，才有一筆用力劃上去的感覺
          inkPencil(rocket.last, point, rocket.hue, lerp(1.35, 0.45, p), rocket.nib);
          rocket.last = point;
        }
        continue;
      }
      // 上升的尾巴：記下這一格走過的線段，draw() 再接起來畫成連續的一道，
      // 每格灑幾筆散點會斷成一節一節的
      const eased = rise(progress);
      const point = {
        x: rocket.x + rocket.drift * eased,
        y: lerp(display.height + rocket.base * 0.6, rocket.apexY, eased) + rocket.base * 0.34
      };
      rocket.tailFrom = rocket.last;
      rocket.last = point;
    }

    for (let i = holes.length - 1; i >= 0; i -= 1) {
      holes[i].t += TEAR_SPEED;
      // 撕開 6 格 + 撐 TEAR_HOLD 格 + 倒放 6 格，用 TEAR_SPEED 倍速跳著播
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
        // 綻放期：剪影跟著照片一起脹大並淡入，看得出是貓、又不會停在原地變成暫停
        stroke.hold -= 1;
        stroke.bloom = 1 - stroke.hold / stroke.holdTotal;
        stroke.x = lerp(stroke.ox, stroke.bloomX, stroke.bloom);
        stroke.y = lerp(stroke.oy, stroke.bloomY, stroke.bloom);
        if (stroke.hold === 0) {
          // 交給下一段之前把起點更新成現在的位置，聚攏時才不會彈回原尺寸
          stroke.ox = stroke.x;
          stroke.oy = stroke.y;
        }
        continue;
      }
      if (stroke.gather > 0) {
        // 剪影炸開放大：所有粒子往自己那個角度的輪廓上跑，聚成一個放大的貓頭形狀。
        // 這段不衰減也不吃重力，形狀才撐得住
        stroke.gather -= 1;
        const t = 1 - stroke.gather / stroke.gatherTotal;
        const eased = t * t * (3 - 2 * t);
        stroke.x = lerp(stroke.ox, stroke.rimX, eased);
        stroke.y = lerp(stroke.oy, stroke.rimY, eased);
        continue;
      }
      stroke.x += stroke.vx;
      stroke.y += stroke.vy;
      stroke.vy += 0.7;
      stroke.vx *= 0.94;
      stroke.vy *= 0.94;
      stroke.life -= stroke.decay;
      if (stroke.life <= 0 || stroke.y > display.height + 60) {
        strokes.splice(i, 1);
      }
    }
  }

  function drawStroke(stroke) {
    const life = clamp(stroke.life, 0, 1);

    // 保留取樣到的原始毛色。定格時是方塊才拼得成完整剪影，
    // 一開始聚攏就改畫圓點並縮小，從「馬賽克的貓」變成一圈火花
    if (stroke.hold > 0) {
      const cell = stroke.height * lerp(1, BLOOM_SCALE, stroke.bloom);
      context.globalAlpha = stroke.bloom;
      context.fillStyle = `rgb(${stroke.color})`;
      context.fillRect(stroke.x - cell / 2, stroke.y - cell / 2, cell, cell);
      context.globalAlpha = 1;
      return;
    }
    // 大半輩子維持滿亮度、最後才快速淡掉，粒子數量看起來才是不變的
    context.globalCompositeOperation = "lighter";
    context.fillStyle = `rgba(${stroke.color}, ${Math.min(1, life * 2.6) * 0.92})`;
    context.beginPath();
    context.arc(stroke.x, stroke.y, stroke.width * lerp(0.26, 0.7, life), 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = "source-over";
  }

  // ── 紙張破裂煙火 ───────────────────────────────────────────────

  // 一般的紙張質感：米白底、細顆粒、幾道很淡的纖維，不要折痕線條
  function paintPaper() {
    const w = display.width;
    const h = display.height;
    sizeCanvas(paperCanvas, paperContext);
    sizeCanvas(pencilCanvas, pencilContext);
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

  // ── 洞後面的流體背景 ─────────────────────────────────────────
  // 黑底上的灰銀湍流，邊緣泛出霓虹虹光。每個像素都要各自算域變形雜訊，
  // Canvas 2D 逐像素在 12fps 下跑不動，所以這層是一支 fragment shader。

  const FLOW_VERT = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  const FLOW_FRAG = `
    precision highp float;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uHue;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    // 值雜訊：四角取樣再用 smoothstep 內插，比 Perlin 便宜、疊起來看不出差別
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    // 四層就夠了。再多層只是在已經被域變形扭爛的圖上加看不見的細節，白花 GPU
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + 17.3;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      // 兩軸都用高度正規化，長寬比才不會把圖案壓扁；x 取樣比 y 密，
      // 流體就會是被拖長的條狀而不是一團團的雲
      vec2 uv = gl_FragCoord.xy / uResolution.y;
      vec2 p = vec2(uv.x * 3.6, uv.y * 2.4);
      float t = uTime;

      // 域變形：拿一層 fbm 的輸出去偏移下一層的取樣座標，平行的紋路就會被扭成漩渦。
      // 這是大理石／潑漆那種湍流感唯一的來源，少了它就只是一團雲
      vec2 q = vec2(fbm(p + vec2(0.0, t * 0.12)), fbm(p + vec2(4.7 - t * 0.09, 2.1)));
      vec2 r = vec2(fbm(p + 4.2 * q + vec2(1.7, 9.2)), fbm(p + 4.2 * q + vec2(8.3, 2.8)));
      float f = fbm(p + 4.0 * r);

      // 整片都是流體，只是調子從近黑到亮白連續變化——不用門檻把「有沒有流體」切開。
      // 切開的話低於門檻的地方會變成一大片純黑的空洞，畫面就空了一半。
      // 取值範圍刻意開得比 fbm 實際範圍寬（不裁掉兩端），再用 gamma 把中間調壓暗，
      // 這樣暗部仍然看得到流動的紋理，而不是死黑
      float v = smoothstep(0.10, 0.78, f);
      float tone = pow(v, 1.2);
      float shade = 0.22 + 0.78 * smoothstep(0.18, 0.72, f + 0.3 * r.x);
      vec3 col = vec3((0.045 + 0.93 * tone) * (0.55 + 0.45 * shade));

      // 亮脈：很窄的一道白，做出液態金屬的高光稜線
      col += vec3((1.0 - smoothstep(0.0, 0.014, abs(f - 0.60))) * 0.9);

      // 遮罩控制虹光長在哪些區域。每條等值線都上虹光的話，整張圖會變成滿滿的
      // 霓虹電線；但遮罩頻率訂太低（試過 0.5）整張圖只會有一兩塊彩虹擠在角落。
      // 頻率抬高讓彩虹散佈到全畫面，門檻同時抬高把每一塊的面積壓小
      float mask = smoothstep(0.3, 0.5, fbm(p * 1.3 + vec2(40.0, 17.0)));
      float bandA = (1.0 - smoothstep(0.0, 0.050, abs(f - 0.47))) * mask;
      float bandB = (1.0 - smoothstep(0.0, 0.028, abs(f - 0.57))) * mask;
      float amount = clamp(bandA + bandB * 0.8, 0.0, 1.0);

      // 先把底下的灰壓掉再上色。直接加在白色上只會被洗成粉彩，
      // 目標是彩虹「取代」那塊流體的顏色，不是疊在上面
      col *= 1.0 - 0.8 * amount;
      float phase = uHue + f * 5.0 + r.x * 2.0;
      col += (0.5 + 0.5 * cos(6.2831 * (phase + vec3(0.0, 0.33, 0.67)))) * amount * 1.45;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  let flowProgram = null;
  let flowLocations = null;
  let flowTried = false;

  function initFlow() {
    flowTried = true;
    if (!gl) {
      return;
    }
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, FLOW_VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FLOW_FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }
    // 一個蓋滿畫面的大三角形，比兩個三角形的 quad 少一次頂點處理也沒有對角線接縫
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    flowProgram = program;
    flowLocations = {
      resolution: gl.getUniformLocation(program, "uResolution"),
      time: gl.getUniformLocation(program, "uTime"),
      hue: gl.getUniformLocation(program, "uHue")
    };
  }

  // 整片鋪滿畫面、和洞無關，洞只是把它露出來的遮罩，
  // 所以洞變大變小時後面的畫面不會跟著縮放。
  function paintFlow() {
    // 固定直式比例，再拉伸貼滿畫面。寬螢幕上的橫向拉伸是刻意的——
    // 紋理被拉長才有流體被拖開的感覺，比例「正確」反而變得細碎。
    // 「只看背景動態」會拉滿全螢幕所以畫大一點
    const w = state.style === "flow" ? 960 : 480;
    const h = Math.round(w * 1.25);
    if (flowCanvas.width !== w) {
      flowCanvas.width = w;
      flowCanvas.height = h;
    }
    flowTick += 1;
    if (!flowTried) {
      initFlow();
    }
    if (!flowProgram) {
      return; // 沒有 WebGL 就讓這層留白，破口的紙片動畫本身還是照跑
    }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(flowLocations.resolution, w, h);
    gl.uniform1f(flowLocations.time, flowTick * 0.022);
    gl.uniform1f(flowLocations.hue, baseHue / 360);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // 撕開的破口用序列圖播放：程式畫的多邊形怎麼調都不夠自然。
  // 一組 6 格從小撕到大，撐幾格之後原樣倒放合回去。
  function punchHole(rocket, x, y) {
    const size = rocket.base * 2.2; // 貼片邊長；破口約佔貼片的七成
    holes.push({
      x,
      y,
      size,
      set: TEAR_SETS[Math.floor(Math.random() * TEAR_SETS.length)],
      t: 0
    });
    sparkPencil(x, y, size * 0.42, rocket.hue, rocket.nib * 1.2);
  }

  // 破口周圍甩出幾筆色鉛筆短觸，當成煙火綻放的線條。
  // 一次全部畫完：破口本身只開合幾格，線條慢慢長出來反而拖住節奏
  function sparkPencil(x, y, radius, hue, nib) {
    const rays = Math.round(random(10, 18));
    const start = random(0, Math.PI * 2);
    for (let i = 0; i < rays; i += 1) {
      const angle = start + (i / rays) * Math.PI * 2 + random(-0.2, 0.2);
      const inner = radius * random(0.8, 1);
      const outer = radius * random(1.15, 1.9);
      const bend = random(-0.32, 0.32); // 帶一點弧度才像手甩的，不然是放射狀直線
      const rayHue = (hue + random(-45, 45) + 360) % 360;
      let from = { x: x + Math.cos(angle) * inner, y: y + Math.sin(angle) * inner };
      for (let s = 1; s <= 2; s += 1) {
        const t = s / 2;
        const a = angle + bend * t;
        const r = lerp(inner, outer, t);
        const to = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
        inkPencil(from, to, rayHue, lerp(1.1, 0.35, t), nib); // 由重到輕，末端收出筆鋒
        from = to;
      }
    }
  }

  function tearIndex(hole) {
    const t = Math.floor(hole.t);
    if (t < TEAR_FRAMES) {
      return t;
    }
    if (t < TEAR_FRAMES + TEAR_HOLD) {
      return TEAR_FRAMES - 1;
    }
    return TEAR_FRAMES - 1 - (t - TEAR_FRAMES - TEAR_HOLD);
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
  // 橫向用低頻擺動而不是純隨機，線才會像手畫的自然彎曲
  function pencilPoint(rocket, progress) {
    const eased = flick(progress);
    return {
      x: rocket.x + rocket.drift * eased
        + Math.sin(progress * 5.5 + rocket.spin * 12) * rocket.base * 0.11 + random(-1.5, 1.5),
      y: lerp(display.height + rocket.base * 0.2, rocket.apexY, eased) + random(-1.5, 1.5)
    };
  }

  function inkPencil(from, to, hue, pressure, nib) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const nx = -dy / (length || 1);
    const ny = dx / (length || 1);
    const steps = Math.max(2, Math.round(length / 1.2));
    const reach = 5.5 * pressure * nib;
    // 顆粒數要跟著筆芯變寬一起加，不然粗筆只是把同樣的顆粒撒得更散、變成一條稀疏的霧
    const grains = Math.round(11 * nib);

    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;
      for (let j = 0; j < grains; j += 1) {
        // 用兩個亂數相加逼近常態分布，顆粒才會集中在筆芯中央
        const spread = (Math.random() + Math.random() - 1) * reach;
        const fade = 1 - Math.abs(spread) / reach;
        // 色鉛筆：中央濃、邊緣淡。亮度要壓在中間偏亮——同一點會被幾十顆顆粒疊到，
        // 疊加後只會越來越暗，起始值訂低的話整條線最後就變成看不出顏色的深色
        pencilContext.fillStyle = `hsla(${hue}, ${lerp(70, 92, fade)}%, ${lerp(72, 54, fade)}%, ${0.08 + fade * 0.26})`;
        pencilContext.fillRect(cx + nx * spread, cy + ny * spread, 1, 1);
      }
      // 偶爾壓重一點，色鉛筆的深淺才有變化
      if (Math.random() < 0.22) {
        pencilContext.fillStyle = `hsla(${hue}, 95%, 46%, 0.35)`;
        pencilContext.fillRect(
          cx + nx * random(-1.4, 1.4) * nib,
          cy + ny * random(-1.4, 1.4) * nib,
          random(1, 2.2) * nib,
          random(1, 2.2) * nib
        );
      }
    }
  }

  function drawPaperScene() {
    // 紙與鉛筆層的 backing store 已經乘過 dpr，所以要指定 CSS 尺寸貼回去
    context.drawImage(paperCanvas, 0, 0, display.width, display.height);
    context.drawImage(pencilCanvas, 0, 0, display.width, display.height);
    // 沒有破口就沒人看得到這層，不用花 GPU 去算。停在原格再接著跑也看不出接縫
    if (!holes.length) {
      return;
    }
    paintFlow();
    for (const hole of holes) {
      drawHole(hole);
    }
  }

  function drawCat(rocket) {
    const progress = clamp(rocket.elapsed / rocket.riseMs, 0, 1);
    const eased = rise(progress);
    const frameIndex = Math.min(FRAME_COUNT - 1, Math.floor(progress * FRAME_COUNT));
    const set = frames[rocket.cat];
    const image = set && set[frameIndex];
    if (!image || !image.complete || !image.naturalWidth) {
      return;
    }

    // 綻放期：到頂點後照片不停住，繼續放大並淡出，讓底下同步脹大的粒子剪影接手
    const bloom = rocket.fade ? 1 - (rocket.fade - 1) / BLOOM_STEPS : 0;
    const size = rocket.base * lerp(0.4, 1, eased) * lerp(1, BLOOM_SCALE, bloom);
    const x = rocket.x + rocket.drift * eased;
    const y = lerp(display.height + size * 0.6, rocket.apexY, eased);
    const side = Math.max(2, Math.round(size));

    // 不染色，寫實毛色要看得出品種；只靠煙火色的外暈把貓咪接回畫面
    catContext.save();
    catContext.globalAlpha = 1 - bloom;
    catContext.translate(x, y);
    catContext.rotate(rocket.spin * (1 - eased));
    catContext.shadowColor = `hsla(${rocket.hue}, 85%, 62%, 0.8)`;
    catContext.shadowBlur = size * 0.26;
    catContext.drawImage(image, -side / 2, -side / 2, side, side);
    catContext.restore();
  }

  function draw() {
    catContext.clearRect(0, 0, display.width, display.height);

    if (state.style === "flow") {
      // 把紙撕掉之後看到的那層：整片流動動畫直接鋪滿畫面
      paintFlow();
      context.drawImage(flowCanvas, 0, 0, display.width, display.height);
      return;
    }

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

    // 尾巴只畫這一格新增的線段，舊的靠拖尾自己淡掉，接起來就是連續的一道
    context.save();
    context.lineCap = "round";
    context.globalCompositeOperation = "lighter";
    for (const rocket of rockets) {
      if (!rocket.tailFrom || !rocket.last) {
        continue;
      }
      const width = Math.max(1.2, rocket.base * 0.016);
      context.strokeStyle = `hsla(${rocket.hue}, 90%, 62%, 0.45)`;
      context.lineWidth = width * 3.2;
      context.beginPath();
      context.moveTo(rocket.tailFrom.x, rocket.tailFrom.y);
      context.lineTo(rocket.last.x, rocket.last.y);
      context.stroke();
      context.strokeStyle = `hsla(${rocket.hue}, 60%, 92%, 0.95)`;
      context.lineWidth = width;
      context.stroke();
    }
    context.restore();

    for (const rocket of rockets) {
      // fade > 0 的是綻放期，照片還要放大淡出幾格才交棒給粒子
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
    resumeAudio().catch(() => { });
  }

  function bindAudioResume() {
    const handler = () => {
      resumeAudio().catch(() => { });
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
