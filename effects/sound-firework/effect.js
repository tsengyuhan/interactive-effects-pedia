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
    // 紙張是色鉛筆：每一發隨機抽色，像從一盒色鉛筆裡輪流挑；貓咪則跟著使用者選的煙火色
    const hue = state.style === "paper"
      ? random(0, 360)
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
            inkPencil(rocket.last, { x: rocket.x + rocket.drift, y: rocket.apexY }, rocket.hue, 0.45);
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
          inkPencil(rocket.last, point, rocket.hue, lerp(1.35, 0.45, p));
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

  // 洞後面透出的循環動畫：全息大理石的流動。整片鋪滿畫面、和洞無關，
  // 洞只是把它露出來的遮罩，所以洞變大變小時後面的畫面不會跟著縮放。
  function paintFlow() {
    // 破口只露出這張圖的一小塊，解析度不夠的話紋理會變成幾片色塊。
    // 「只看背景動態」時它會被拉滿全螢幕，所以畫布加倍——但用 setTransform 把座標縮回
    // 480×600，下面的紋理數值一個都不用改，圖案尺度也不會跟著變
    const w = 480;
    const h = 600;
    const zoom = state.style === "flow" ? 2.5 : 1;
    if (flowCanvas.width !== Math.round(w * zoom)) {
      flowCanvas.width = Math.round(w * zoom);
      flowCanvas.height = Math.round(h * zoom);
      flowContext.setTransform(zoom, 0, 0, zoom, 0, 0);
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
    const size = rocket.base * 2.2; // 貼片邊長；破口約佔貼片的七成
    holes.push({
      x,
      y,
      size,
      set: TEAR_SETS[Math.floor(Math.random() * TEAR_SETS.length)],
      t: 0
    });
    sparkPencil(x, y, size * 0.42, rocket.hue);
  }

  // 破口周圍甩出幾筆色鉛筆短觸，當成煙火綻放的線條。
  // 一次全部畫完：破口本身只開合幾格，線條慢慢長出來反而拖住節奏
  function sparkPencil(x, y, radius, hue) {
    const rays = Math.round(random(8, 13));
    const start = random(0, Math.PI * 2);
    for (let i = 0; i < rays; i += 1) {
      const angle = start + (i / rays) * Math.PI * 2 + random(-0.2, 0.2);
      const inner = radius * random(0.6, 0.85);
      const outer = radius * random(1.15, 1.9);
      const bend = random(-0.32, 0.32); // 帶一點弧度才像手甩的，不然是放射狀直線
      const rayHue = (hue + random(-45, 45) + 360) % 360;
      let from = { x: x + Math.cos(angle) * inner, y: y + Math.sin(angle) * inner };
      for (let s = 1; s <= 2; s += 1) {
        const t = s / 2;
        const a = angle + bend * t;
        const r = lerp(inner, outer, t);
        const to = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
        inkPencil(from, to, rayHue, lerp(1.1, 0.35, t)); // 由重到輕，末端收出筆鋒
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

  function inkPencil(from, to, hue, pressure) {
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
        const reach = 5.5 * pressure;
        const spread = (Math.random() + Math.random() - 1) * reach;
        const fade = 1 - Math.abs(spread) / reach;
        // 色鉛筆：筆芯中央壓得深、顏色濃，往邊緣散開就變淡變亮
        pencilContext.fillStyle = `hsla(${hue}, 72%, ${lerp(60, 30, fade)}%, ${0.16 + fade * 0.5})`;
        pencilContext.fillRect(cx + nx * spread, cy + ny * spread, 1, 1);
      }
      // 偶爾壓重一點，色鉛筆的深淺才有變化
      if (Math.random() < 0.22) {
        pencilContext.fillStyle = `hsla(${hue}, 85%, 26%, 0.5)`;
        pencilContext.fillRect(cx + nx * random(-1.4, 1.4), cy + ny * random(-1.4, 1.4), random(1, 2.2), random(1, 2.2));
      }
    }
  }

  function drawPaperScene() {
    // 紙與鉛筆層的 backing store 已經乘過 dpr，所以要指定 CSS 尺寸貼回去
    context.drawImage(paperCanvas, 0, 0, display.width, display.height);
    context.drawImage(pencilCanvas, 0, 0, display.width, display.height);
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
