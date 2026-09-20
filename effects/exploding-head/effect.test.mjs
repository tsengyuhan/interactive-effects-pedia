import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as physics from './physics.mjs';
import { createBalloon, fillTexture } from './balloon.mjs';

const source = fs.readFileSync(new URL('./effect.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('預設第 12 下到頂，尺寸尚未長大時不爆炸；重置可重玩', () => {
  const state = physics.resetState();
  for (let i = 0; i < 11; i++) physics.pump(state, 1);
  assert.ok(state.pressure < 1);
  physics.pump(state, 1);
  assert.equal(state.pressure, 1);
  assert.equal(state.exploded, false);
  assert.equal(physics.advance(state, 1 / 60, true), false);
  for (let i = 0; i < 180 && !state.exploded; i++) physics.advance(state, 1 / 60, true);
  assert.equal(state.exploded, true);
  assert.ok(state.scale >= physics.MAX_SCALE * 0.985);
  assert.deepEqual(physics.resetState(), { pressure: 0, scale: 1, velocity: 0, exploded: false });
});

test('充氣速度邊界、失去追蹤暫停與彈簧收斂', () => {
  for (const [speed, clicks] of [[0.5, 24], [2, 6]]) {
    const state = physics.resetState();
    for (let i = 0; i < clicks; i++) physics.pump(state, speed);
    assert.equal(state.pressure, 1);
    physics.advance(state, 1, false);
    assert.equal(state.scale, 1);
    assert.equal(state.exploded, false);
  }
  const state = physics.resetState();
  physics.pump(state, 1);
  for (let i = 0; i < 240; i++) physics.advance(state, 1 / 60, true);
  assert.ok(Math.abs(state.scale - (1 + (physics.MAX_SCALE - 1) / 12)) < 0.001);
});

test('頂緣找頭髮、下巴曲線羽化，分離遮罩保留前景總 alpha', () => {
  const data = new Float32Array(100 * 100);
  for (let y = 12; y < 90; y++) for (let x = 25; x < 75; x++) data[y * 100 + x] = 1;
  const head = physics.estimateHead({ originX: 35, originY: 30, width: 30, height: 30 }, data, 100, 100, 100, 100);
  assert.ok(head.top < 12);
  assert.ok(head.left <= 25 && head.right >= 75);
  assert.equal(physics.insideHead(50, 15, head), true);
  assert.equal(physics.insideHead(50, 80, head), false);
  assert.equal(physics.insideHead(25, head.bottom - 1, head), false);
  assert.equal(physics.insideHead(head.cx + 30 * 0.25, head.bottom - 1, head), true);
  assert.equal(physics.insideHead(head.cx + 30 * 0.4, head.bottom - 1, head), false);
  const body = new Uint8ClampedArray(40000), hair = new Uint8ClampedArray(40000);
  physics.splitMask(data, 100, 100, 100, 100, head, body, hair);
  let feathered=0;
  for (let i = 0; i < data.length; i++) {
    assert.equal(body[i * 4 + 3] + hair[i * 4 + 3], data[i] * 255);
    if(body[i*4+3]>0 && hair[i*4+3]>0) feathered++;
  }
  assert.ok(feathered>0);
  assert.equal(hair[(15 * 100 + 50) * 4 + 3], 255);
  assert.equal(body[(80 * 100 + 50) * 4 + 3], 255);
  assert.equal(physics.estimateHead({ originX: 0, originY: 0, width: 0, height: 0 }, data, 100, 100, 100, 100), null);
});

test('最大頭部含浮動與旋轉，在桌面及直橫手機構圖內完整保留', () => {
  const head = { left: 222, right: 418, top: 41, bottom: 246, cx: 320 };
  const bounds = physics.portraitBounds(640, 480, head);
  for (const [width, height] of [[1280, 609], [390, 844], [844, 390]]) {
    const view = physics.fitPortrait(bounds, 640, width, height);
    const limit = height - (height < 500 ? 160 : 210);
    for (const scale of [1, 1 + (physics.MAX_SCALE - 1) * 10 / 12, physics.MAX_SCALE]) {
      const inflation = scale - 1;
      for (let time = 0; time < 12000; time += 137) {
        const angle = Math.sin(time / 720) * inflation * 0.028;
        for (const x of [head.left, head.right]) for (const y of [head.top, head.bottom]) {
          const dx = x - head.cx, dy = y - head.bottom;
          const px = head.cx + Math.sin(time / 580) * inflation * 4 + scale * (dx * Math.cos(angle) - dy * Math.sin(angle));
          const py = head.bottom - inflation * 6 + Math.sin(time / 420) * inflation * 3 + scale * (dx * Math.sin(angle) + dy * Math.cos(angle));
          const screenX = view.x + (640 - px) * view.scale, screenY = view.y + py * view.scale;
          assert.ok(screenX >= 12 - 1e-8 && screenX <= width - 12 + 1e-8);
          assert.ok(screenY >= 72 - 1e-8 && screenY <= limit + 1e-8);
        }
      }
    }
    assert.ok(view.y + 480 * view.scale <= limit + 1e-8);
  }
});

// 只在測試副本置換模型 import，正式頁面沒有偽造模式或測試入口。
function harness(options = {}) {
  const events = {}, documentEvents = {}, elements = [], timers = new Map(), frames = new Map(),params=new Map();
  const counts = { mask: 0, segmenter: 0, detector: 0, tracks: 0, infer: 0, detect: 0, balloon: 0 };
  let nextId = 1, now = 0, errors = [], faceCount = 1, detectedFrame;
  function element(tag) {
    const listeners = {};
    const el = { tag, style: {}, children: [], width: 100, height: 100,
      currentTime: 0, videoWidth: 100, videoHeight: 100, readyState: 2, draws: [],
      append(...children) { this.children.push(...children); },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { listeners[key] = fn; },
      click() { if (!this.disabled) listeners.click?.(); },
      play: async () => {}, pause() {},
      getContext() { return {
        setTransform() {}, fillRect() { el.draws = []; }, clearRect() { el.draws = []; },
        drawImage(...args) { el.draws.push(args); }, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},transform() {},
        createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
        putImageData() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, clip() {},
        getImageData(x,y,width,height) { return {width,height,data:new Uint8ClampedArray(width*height*4).fill(255)}; },
        createLinearGradient() { return { addColorStop() {} }; }
      }; }
    };
    elements.push(el); return el;
  }
  const track = { stop() { counts.tracks++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const segmenter = {
    close() { counts.segmenter++; },
    segmentForVideo(input) {
      counts.infer++; assert.equal(input.tag, 'canvas'); assert.equal(input, detectedFrame);
      return { close() { counts.mask++; }, confidenceMasks: [{ width: 20, height: 20,
        getAsFloat32Array() { if (options.maskThrows) throw new Error('Mask read failed'); return new Float32Array(400).fill(1); }
      }] };
    }
  };
  const detector = {
    close() { counts.detector++; },
    detectForVideo(input) { counts.detect++; assert.equal(input.tag, 'canvas'); detectedFrame = input; return {
      detections: Array.from({ length: faceCount }, () => ({ boundingBox: { originX: 35, originY: 25, width: 30, height: 35 } }))
    }; }
  };
  const modelAPI = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    ImageSegmenter: { createFromOptions: () => options.segmenterPending?.promise || Promise.resolve(segmenter) },
    FaceDetector: { createFromOptions: () => options.detectorPending?.promise || Promise.resolve(detector) }
  };
  const container = element('div'); container.clientWidth = 800; container.clientHeight = 600;
  let extraButtons=0;
  const context = {
    ...physics, modelAPI,fillTexture,
    createBalloon(document) {
      if (options.noWebGL) throw new Error('WebGL unavailable');
      const canvas=document.createElement('canvas');
      return { canvas, update() {}, render() { return canvas; }, release() { counts.balloon++; } };
    }, console: { error() {} }, t: x => x,
    document: { hidden: false, createElement: element,
      addEventListener(key, fn) { documentEvents[key] = fn; }, removeEventListener(key) { delete documentEvents[key]; } },
    Shell: { init() { return {
      container, addParam(config) { params.set(config.key,config); config.onChange(config.value); },
      addButton() { extraButtons++; }, showLoading() {}, hideLoading() {}, showError(msg) { errors.push(msg); }
    }; } },
    navigator: { mediaDevices: { getUserMedia: () => options.cameraDenied ? Promise.reject(new Error('NotAllowedError')) : options.cameraPending?.promise || Promise.resolve(stream) } },
    performance: { now: () => now }, location: { reload() {} },
    setTimeout(fn, delay) { const id = nextId++; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(key, fn) { events[key] = fn; }, removeEventListener(key) { delete events[key]; },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1
  };
  context.window = context;
  const sandbox = vm.createContext(context);
  vm.runInContext(source.replace(/^import[^\n]+\n/gm, '').replace("import('../../libs/mediapipe/vision_bundle.mjs')", 'Promise.resolve(modelAPI)'), sandbox);
  return {
    counts, timers, frames, errors, stream, segmenter, detector,params,
    get extraButtons() { return extraButtons; },
    get button() { return elements.find(el => el.className === 'exploding-pump'); },
    get status() { return elements.find(el => el.className === 'exploding-status').textContent; },
    get drawCount() { return elements.find(el => el.className === 'exploding-stage').draws.length; },
    get state() { return vm.runInContext('({ ...state, tracked, ready, stopped, maxScale, swing:{...swing}, particles: particles.length })', sandbox); },
    get composition() { return vm.runInContext('composition && { ...composition }', sandbox); },
    get layout() { return vm.runInContext('layout()', sandbox); },
    cameraSize(width, height) { const video = elements.find(el => el.tag === 'video'); video.videoWidth = width; video.videoHeight = height; },
    step(ms = 16, fresh = true) {
      now += ms;
      if (fresh) elements.find(el => el.tag === 'video').currentTime += ms / 1000;
      const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn(now));
    },
    hide(hidden) { context.document.hidden = hidden; documentEvents.visibilitychange?.(); },
    faces(count) { faceCount = count; },
    reset() { vm.runInContext('resetEffect()',sandbox); },
    param(key,value) { params.get(key).onChange(value); },
    leave() { events.pagehide(); },
    timeout(delay) { const found = [...timers.entries()].find(([, timer]) => timer.delay === delay); assert.ok(found); timers.delete(found[0]); found[1].fn(); }
  };
}

test('第一有效頭部才鎖構圖，打氣／失追不縮放，重置與相機尺寸改變重新校準', async () => {
  const page = harness(); page.faces(0); await settle(); page.step();
  assert.equal(page.composition, null);
  page.faces(1); page.step(); const composition = page.composition, view = page.layout;
  assert.ok(composition);
  for (let i = 0; i < 10; i++) { page.button.click(); page.step(); }
  assert.deepEqual(page.composition, composition); assert.deepEqual(page.layout, view);
  page.faces(0); page.step(); page.faces(1); page.step();
  assert.deepEqual(page.composition, composition);
  page.reset(); assert.equal(page.composition, null); page.step();
  assert.deepEqual(page.composition, composition);
  page.faces(0); page.cameraSize(200, 100); page.step(); assert.equal(page.composition, null);
  page.faces(1); page.step(); assert.notDeepEqual(page.composition, composition);
  page.leave();
});

test('完整互動：載入禁用、同幀不重推論、爆炸後追蹤／失追／重置', async () => {
  const page = harness();
  assert.equal(page.button.disabled, true);
  await settle(); page.step();
  assert.equal(page.button.disabled, false);
  const first = page.counts.infer;
  page.step(16, false); assert.equal(page.counts.infer, first);
  for (let i = 0; i < 12; i++) page.button.click();
  assert.equal(page.state.exploded, false);
  assert.equal(page.button.disabled, true);
  for (let i = 0; i < 120 && !page.state.exploded; i++) page.step();
  assert.equal(page.state.exploded, true); assert.equal(page.state.particles, 32);
  assert.equal(page.button.textContent,'重置'); assert.equal(page.button.disabled,false);
  page.faces(0); page.step();
  assert.equal(page.state.tracked, false); assert.match(page.status, /追蹤遺失/);
  page.faces(1); page.step(); assert.equal(page.state.exploded, true);
  for (let i = 0; i < 440; i++) page.step();
  assert.equal(page.drawCount, 1);
  page.faces(0); page.step(); assert.equal(page.drawCount, 0);
  page.faces(1); page.step(); assert.equal(page.drawCount, 1);
  page.reset(); assert.equal(page.state.pressure, 0); assert.equal(page.state.particles, 0);
  assert.equal(page.button.disabled, false);
  page.faces(2); page.step(); assert.equal(page.button.disabled, true);
  page.faces(1); page.step(); page.step(800, false); assert.equal(page.button.disabled, true);
  page.step(); assert.equal(page.button.disabled, false);
  assert.equal(page.counts.infer, page.counts.mask);
  assert.equal(page.counts.infer, page.counts.detect);
  page.leave(); assert.equal(page.frames.size, 0);
  assert.equal(page.counts.segmenter, 1); assert.equal(page.counts.detector, 1); assert.equal(page.counts.tracks, 1); assert.equal(page.counts.balloon, 1);
});

test('背景分頁停止 RAF，返回只排一個迴圈', async () => {
  const page = harness(); await settle(); page.step();
  const before = page.counts.infer;
  page.hide(true); page.step();
  assert.equal(page.frames.size, 0); assert.equal(page.counts.infer, before); assert.equal(page.button.disabled, true);
  page.hide(false); assert.equal(page.frames.size, 1); page.step(); assert.equal(page.counts.infer, before + 1);
  page.leave();
});

test('相機權限拒絕顯示繁中錯誤並禁用打氣', async () => {
  const page = harness({ cameraDenied: true }); await settle();
  assert.match(page.errors[0], /請允許攝影機權限/); assert.equal(page.button.disabled, true);
  assert.equal(page.state.stopped, true); assert.equal(page.frames.size, 0);
});

test('相機逾時及離頁後才授權，都釋放晚到串流', async () => {
  for (const timeout of [true, false]) {
    const pending = deferred(), page = harness({ cameraPending: pending });
    if (timeout) { page.timeout(20000); await settle(); } else page.leave();
    pending.resolve(page.stream); await settle();
    assert.ok(page.counts.tracks >= 1); assert.equal(page.frames.size, 0); assert.equal(page.counts.infer, 0);
  }
});

test('初始化模型途中離頁，先前與晚到模型皆關閉', async () => {
  for (const model of ['segmenter', 'detector']) {
    const pending = deferred(), page = harness({ [`${model}Pending`]: pending });
    await settle(); page.leave(); pending.resolve(page[model]); await settle();
    assert.equal(page.counts[model], 1); assert.equal(page.counts.tracks, 1);
    if (model === 'detector') assert.equal(page.counts.segmenter, 1);
    assert.equal(page.frames.size, 0); assert.equal(page.errors.length, 0);
  }
});

test('mask 讀取例外仍釋放結果、模型與串流', async () => {
  const page = harness({ maskThrows: true }); await settle(); page.step();
  assert.equal(page.counts.mask, 1); assert.equal(page.counts.segmenter, 1); assert.equal(page.counts.detector, 1);
  assert.equal(page.counts.tracks, 1); assert.match(page.errors[0], /人像處理失敗/);
});

test('模型載入拒絕與逾時會關閉已有資源，晚到模型也會釋放', async () => {
  for (const timeout of [false, true]) {
    const pending = deferred(), page = harness({ detectorPending: pending });
    await settle();
    if (timeout) page.timeout(45000); else pending.reject(new Error('Model unavailable'));
    await settle();
    assert.equal(page.state.stopped, true); assert.equal(page.counts.segmenter, 1); assert.equal(page.counts.tracks, 1);
    assert.equal(page.button.disabled, true); assert.equal(page.errors.length, 1);
    if (timeout) { pending.resolve(page.detector); await settle(); assert.equal(page.counts.detector, 1); }
  }
});

test('模型初始化中切到背景不誤報逾時，回前景才推論', async () => {
  const pending = deferred(), page = harness({ detectorPending: pending }); await settle();
  page.hide(true);
  assert.equal(page.timers.size, 0);
  pending.resolve(page.detector); await settle();
  assert.equal(page.frames.size, 0); assert.equal(page.errors.length, 0);
  page.hide(false); assert.equal(page.frames.size, 1); page.step();
  assert.equal(page.button.disabled, false); page.leave();
});

test('效果內中文 UI（含動態狀態及 shell 標籤）都有英文翻譯', () => {
  const i18n = fs.readFileSync(new URL('../../assets/i18n.js', import.meta.url), 'utf8');
  const context = { localStorage: { getItem: () => 'en' }, document: {
    createElement: () => ({ style: {} }), head: { append() {} }, addEventListener() {}, documentElement: {}, querySelectorAll: () => []
  } };
  context.window = context;
  vm.runInNewContext(i18n, context);
  const strings = [...source.matchAll(/(['"])((?:\\.|(?!\1).)*?)\1/g)].map(match => match[2]).filter(value => /[一-鿿]/.test(value));
  assert.ok(strings.length >= 18);
  assert.ok(strings.includes('充氣速度') && strings.includes('快爆炸了…'));
  for (const value of strings) assert.notEqual(context.t(value), value, `缺翻譯：${value}`);
});

test('效果依賴僅引用存在的本地檔案', () => {
  assert.doesNotMatch(source, /https?:\/\//);
  for (const path of ['./physics.mjs', './balloon.mjs', '../../libs/mediapipe/vision_bundle.mjs', '../../libs/mediapipe/selfie_segmenter.tflite', '../../libs/mediapipe/blaze_face_short_range.tflite', '../../libs/mediapipe/wasm/vision_wasm_internal.wasm', '../../libs/mediapipe/wasm/vision_wasm_nosimd_internal.wasm']) {
    assert.ok(fs.existsSync(new URL(path, import.meta.url)), path);
  }
});

test('不規則分割覆蓋整個圓面，面積與邊數有差異且不重疊', () => {
  let seed=12345;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const cells=physics.fractureBalloon(32,random);
  assert.equal(cells.length,32);
  assert.ok(Math.abs(cells.reduce((sum,cell)=>sum+cell.area,0)-Math.PI)<.003);
  assert.ok(Math.max(...cells.map(cell=>cell.area))/Math.min(...cells.map(cell=>cell.area))>2);
  assert.ok(new Set(cells.map(cell=>cell.polygon.length)).size>2);
  const contains=(polygon,x,y)=>polygon.every((a,i)=>{
    const b=polygon[(i+1)%polygon.length]; return (b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)>=-1e-9;
  });
  for(let i=0;i<500;i++) {
    const angle=random()*Math.PI*2,radius=Math.sqrt(random())*.99;
    assert.equal(cells.filter(cell=>contains(cell.polygon,Math.cos(angle)*radius,Math.sin(angle)*radius)).length,1);
  }
});

test('薄片受阻力減速、翻面且維持有限值，30與120fps軌跡接近', () => {
  const initial={x:0,y:0,vx:220,vy:-180,angle:0,flip:0,tilt:0,flipSpeed:4,tiltSpeed:1.3,spin:2,drag:1.1,phase:.7,age:0};
  const slow={...initial},fast={...initial};
  for(let i=0;i<180;i++) physics.advanceShard(slow,1/30);
  for(let i=0;i<720;i++) physics.advanceShard(fast,1/120);
  for(const value of Object.values(slow)) assert.ok(Number.isFinite(value));
  assert.ok(Math.hypot(slow.x-fast.x,slow.y-fast.y)<1);
  assert.ok(slow.y>100 && slow.y<1000);
  assert.ok(slow.vy>0 && slow.vy<300);
  assert.ok(Math.abs(slow.vx)<Math.abs(initial.vx));
  assert.ok(slow.flip>10 && slow.spin<initial.spin);
});

test('新氣球輪廓含橫向鼓起與回彈均在構圖內，neck anchor不隨氣量漂移', () => {
  const head={left:222,right:418,top:41,bottom:246,cx:320,chinWidth:34};
  const bounds=physics.portraitBounds(640,480,head);
  for(const [width,height] of [[1280,609],[390,844],[844,390]]) {
    const view=physics.fitPortrait(bounds,640,width,height);
    for(const pressure of [0,.5,.92,1]) for(const velocity of [-2,0,3]) for(let now=0;now<7000;now+=137) {
      const pose=physics.balloonPose(head,{scale:1+pressure*(physics.MAX_SCALE-1),pressure,velocity},now,view);
      assert.equal(pose.anchorX,head.cx); assert.equal(pose.anchorY,head.bottom+(head.bottom-head.top)*.06);
      for(let angle=0;angle<Math.PI*2;angle+=.1) {
        const x=Math.cos(angle)*pose.width/2,y=(Math.sin(angle)-1)*pose.height/2;
        const px=pose.x+x*Math.cos(pose.angle)-y*Math.sin(pose.angle),py=pose.y+x*Math.sin(pose.angle)+y*Math.cos(pose.angle);
        const sx=view.x+(640-px)*view.scale,sy=view.y+py*view.scale;
        assert.ok(sx>=12 && sx<=width-12 && sy>=72 && sy<=height-(height<500?160:210));
      }
    }
  }
});

test('透明貼圖只由有效前景延伸，不混入去背區的像素', () => {
  const pixels=new Uint8ClampedArray(5*5*4);
  for(let i=0;i<25;i++) pixels.set([0,255,0,0],i*4);
  pixels.set([180,110,80,255],(2*5+2)*4);
  fillTexture(pixels,5,5);
  for(let i=0;i<25;i++) assert.deepEqual([...pixels.slice(i*4,i*4+4)],[180,110,80,i===12?255:0]);
  const striped=new Uint8ClampedArray(5*5*4);
  for(let y=0;y<5;y++) striped.set([y%2?0:240,90,60,255],(y*5+2)*4);
  fillTexture(striped,5,5);
  for(let y=0;y<5;y++) assert.equal(striped[(y*5+2)*4],y%2?0:240);
  assert.ok(striped[(2*5)*4]>0 && striped[(2*5)*4]<240);
});

test('WebGL不可用顯示清楚錯誤且不開相機，正常離頁釋放球面', async () => {
  const unsupported=harness({noWebGL:true}); await settle();
  assert.match(unsupported.errors[0],/3D 氣球/); assert.equal(unsupported.state.stopped,true);
  assert.equal(unsupported.counts.infer,0); assert.equal(unsupported.counts.tracks,0);
  const page=harness(); await settle(); page.step(); page.reset(); page.leave(); page.leave();
  assert.equal(page.counts.balloon,1);
});

test('GPU配置失敗會清理已建立資源', () => {
  const deleted=[];
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,
    createProgram:()=>({kind:'program'}),createShader:()=>({kind:'shader'}),
    shaderSource(){},compileShader(){},getShaderParameter:()=>false,getShaderInfoLog:()=> 'compile failed',
    deleteShader:()=>deleted.push('shader'),deleteProgram:()=>deleted.push('program'),
    getExtension:()=>({loseContext:()=>deleted.push('context')})
  };
  assert.throws(()=>createBalloon({createElement:()=>({getContext:()=>gl})}),/compile failed/);
  assert.deepEqual(deleted,['shader','program','context']);
});

test('最大倍數改變爆炸門檻、保持氣量，充氣過程身體構圖固定', async () => {
  for(const max of [1.5,2.35,4]) {
    const state=physics.resetState();
    for(let i=0;i<12;i++) physics.pump(state,1);
    for(let i=0;i<240 && !state.exploded;i++) physics.advance(state,1/60,true,max);
    assert.equal(state.exploded,true); assert.ok(state.scale>=max*.985);
    assert.ok(Math.abs(state.scale-max)<.12);
  }
  const page=harness(); await settle(); page.step();
  for(let i=0;i<6;i++) page.button.click();
  const pressure=page.state.pressure;
  page.param('maxScale',4); assert.equal(page.state.pressure,pressure);
  const large=page.composition;
  for(let i=0;i<60;i++) page.step();
  assert.deepEqual(page.composition,large);
  page.param('maxScale',1.5); assert.equal(page.state.pressure,pressure);
  assert.notDeepEqual(page.composition,large); assert.ok(page.state.scale<=1.25);
  page.reset(); assert.equal(page.state.maxScale,1.5); page.leave();
});

test('底部唯一按鈕爆炸後立即可重置，即使沒有臉也能回到打氣', async () => {
  const page=harness(); await settle(); page.step();
  assert.equal(page.extraButtons,0); assert.equal(page.button.textContent,'打氣');
  for(let i=0;i<12;i++) page.button.click();
  assert.equal(page.button.disabled,true);
  for(let i=0;i<120 && !page.state.exploded;i++) page.step();
  assert.equal(page.button.disabled,false); assert.equal(page.button.textContent,'重置');
  page.faces(0); page.step(); assert.equal(page.button.disabled,false);
  page.button.click(); assert.equal(page.state.pressure,0); assert.equal(page.state.particles,0);
  assert.equal(page.button.textContent,'打氣'); assert.equal(page.button.disabled,true);
  assert.equal(page.state.swing.angle,0); assert.equal(page.state.swing.previousX,null);
  page.faces(1); page.step(); assert.equal(page.button.disabled,false); page.leave();
});

test('甩動由追蹤驅動、左右對稱、停止後回彈並衰減，重獲追蹤不暴衝', () => {
  const run=(fps,direction=1)=>{
    const swing=physics.resetSwing(),dt=1/fps;
    physics.trackSwing(swing,320,0,640);
    for(let i=1;i<=fps/2;i++) {
      physics.trackSwing(swing,320+direction*100*i/(fps/2),i*dt*1000,640);
      physics.advanceSwing(swing,dt);
    }
    return swing;
  };
  const right=run(60),left=run(60,-1),slow=run(30),fast=run(120);
  assert.ok(right.angle<-.05); assert.ok(Math.abs(right.angle+left.angle)<1e-10);
  assert.ok(Math.abs(slow.angle-fast.angle)<.02);
  const peak=Math.abs(right.angle); let rebounded=false;
  for(let i=0;i<300;i++) { physics.advanceSwing(right,1/60); if(right.angle>0) rebounded=true; }
  assert.ok(rebounded); assert.ok(Math.abs(right.angle)<peak*.005);
  const reacquired=physics.resetSwing(); physics.trackSwing(reacquired,620,4000,640);
  physics.advanceSwing(reacquired,1/60); assert.equal(reacquired.angle,0);
  physics.trackSwing(reacquired,100,4017,640); assert.equal(reacquired.velocity,0);
  const still=physics.resetSwing();
  for(let i=0;i<120;i++) { physics.trackSwing(still,320,i*16,640); physics.advanceSwing(still,1/60); }
  assert.equal(still.angle,0);
});

test('全部尺寸與最大甩動保留球面輪廓，身體比例不受擺動影響', () => {
  const head={left:222,right:418,top:41,bottom:246,cx:320,chinWidth:34};
  for(const max of [1.5,2.35,4]) for(const [width,height] of [[1280,609],[390,844],[844,390]]) {
    const view=physics.fitPortrait(physics.portraitBounds(640,480,head,max),640,width,height);
    for(const angle of [-physics.MAX_SWING,0,physics.MAX_SWING]) {
      const pose=physics.balloonPose(head,{scale:max,pressure:1,velocity:3},0,view,{angle});
      for(let theta=0;theta<Math.PI*2;theta+=.05) {
        const x=Math.cos(theta)*pose.width/2,y=(Math.sin(theta)-1)*pose.height/2;
        const px=pose.x+x*Math.cos(angle)-y*Math.sin(angle),py=pose.y+x*Math.sin(angle)+y*Math.cos(angle);
        const sx=view.x+(640-px)*view.scale,sy=view.y+py*view.scale;
        assert.ok(sx>=12 && sx<=width-12 && sy>=72 && sy<=height-(height<500?160:210));
      }
    }
  }
});
