import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as physics from './physics.mjs';
import * as sceneAPI from './scene.mjs';
import * as groundAPI from './ground.mjs';
import * as roomAPI from './room.mjs';
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


// 只在測試副本置換模型 import，正式頁面沒有偽造模式或測試入口。
function harness(options = {}) {
  const events = {}, documentEvents = {}, elements = [], timers = new Map(), frames = new Map(),params=new Map();
  const counts = { mask: 0, segmenter: 0, detector: 0, tracks: 0, infer: 0, detect: 0, balloon: 0,balloonShadow:0 };
  let nextId = 1, now = 0, errors = [], faceCount = 1, detectedFrame,faceX=35,eyePoints=[{x:.4,y:.4},{x:.6,y:.4}];
  const renders=[];
  function element(tag) {
    const listeners = {};
    const el = { tag, style: {}, children: [], width: 100, height: 100,
      currentTime: 0, videoWidth: 100, videoHeight: 100, readyState: 2, draws: [],operations:[],
      append(...children) { this.children.push(...children); },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { listeners[key] = fn; },
      click() { if (!this.disabled) listeners.click?.(); },
      play: async () => {}, pause() {},
      getContext() { return {
        setTransform() {}, fillRect() { el.draws = [];el.operations=[]; }, clearRect() { el.draws = []; },
        drawImage(...args) { el.draws.push(args);el.operations.push({type:'image',source:args[0]}); }, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},transform() {},
        createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
        putImageData() {}, ellipse() {}, fill() {}, stroke() {el.operations.push({type:'stroke',color:this.strokeStyle});}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, clip() {},
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
      detections: Array.from({ length: faceCount }, () => ({ boundingBox: { originX: faceX, originY: 25, width: 30, height: 35 },keypoints:eyePoints }))
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
    ...physics,...sceneAPI,...groundAPI,modelAPI,fillTexture,
    drawBalloonShadow(...args) {counts.balloonShadow++;groundAPI.drawBalloonShadow(...args);},
    createSceneAssets() {return {bottle:element('img'),ready:options.assetFailed?Promise.reject(new Error('missing bottle')):Promise.resolve(),release(){counts.assets=(counts.assets||0)+1;}};},
    createBalloon(document) {
      if (options.noWebGL) throw new Error('WebGL unavailable');
      const canvas=document.createElement('canvas');
      return { canvas, update() {}, render(...args) { renders.push(args);return canvas; }, release() { counts.balloon++; } };
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
    counts, timers, frames, errors, stream, segmenter, detector,params,renders,
    get pieces() { return vm.runInContext('particles.map(p=>({...p}))',sandbox); },
    get sceneImages() {return vm.runInContext('[sceneAssets?.bottle]',sandbox);},
    get drawnImageSizes() {return elements.find(el=>el.className==='exploding-stage').draws.filter(args=>args.length===5).map(args=>args.slice(3));},
    get extraButtons() { return extraButtons; },
    get button() { return elements.find(el => el.className === 'exploding-pump'); },
    get drawSources() { return elements.find(el => el.className === 'exploding-stage').draws.map(args=>args[0]); },
    get drawOps() {return elements.find(el=>el.className==='exploding-stage').operations;},
    get ballCanvas() { return vm.runInContext('balloon?.canvas',sandbox); },
    get drawCount() { return elements.find(el => el.className === 'exploding-stage').draws.length; },
    get state() { return vm.runInContext('({ ...state, tracked, ready, stopped, maxScale, fisheye, ropeScale, resetElapsed, tether:tether?.points.map(p=>({...p})), swing:{...swing}, particles: particles.length })', sandbox); },
    get pose() {return vm.runInContext('lastPose && {...lastPose}',sandbox);},
    get scene() { return vm.runInContext('JSON.parse(JSON.stringify(scene))', sandbox); },
    get layout() { return vm.runInContext('layout()', sandbox); },
    get balloonWidth() { return vm.runInContext('lastPose && lastPose.width', sandbox); },
    cameraSize(width, height) { const video = elements.find(el => el.tag === 'video'); video.videoWidth = width; video.videoHeight = height; },
    step(ms = 16, fresh = true) {
      now += ms;
      if (fresh) elements.find(el => el.tag === 'video').currentTime += ms / 1000;
      const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn(now));
    },
    hide(hidden) { context.document.hidden = hidden; documentEvents.visibilitychange?.(); },
    faces(count) { faceCount = count; },
    faceX(value) {faceX=value;},
    eyes(points) {eyePoints=points;},
    get canReset() {return vm.runInContext('canReset()',sandbox);},
    resize(width,height) {container.clientWidth=width;container.clientHeight=height;events.resize();},
    reset() { vm.runInContext('resetEffect()',sandbox); },
    param(key,value) { params.get(key).onChange(value); },
    leave() { events.pagehide(); },
    timeout(delay) { const found = [...timers.entries()].find(([, timer]) => timer.delay === delay); assert.ok(found); timers.delete(found[0]); found[1].fn(); }
  };
}

function landAll(page) {
  for(let i=0;i<1500 && !page.canReset;i++)page.step(50);
  assert.equal(page.canReset,true,'所有碎片應在合理時間內完成微彈落地');
}

test('場景在尚無臉時已固定，打氣、失追、重置、相機尺寸均不改構圖', async () => {
  const page=harness();page.faces(0);await settle();page.step();
  const scene=page.scene,view=page.layout;assert.ok(scene);
  page.faces(1);page.step();
  for(let i=0;i<6;i++){page.button.click();page.step();}
  page.faces(0);page.step();page.faces(1);page.step();
  assert.deepEqual(page.scene,scene);assert.deepEqual(page.layout,view);
  page.reset();page.step();assert.deepEqual(page.scene,scene);
  page.cameraSize(200,100);page.step();assert.deepEqual(page.scene,scene);page.leave();
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
  const anchor=page.state.tether[0];
  assert.equal(page.button.textContent,'碎片飄落中…'); assert.equal(page.button.disabled,true);
  page.faces(0); page.step();
  assert.deepEqual(page.state.tether[0],anchor);
  assert.equal(page.state.tracked, false);
  page.faces(1); page.step(); assert.equal(page.state.exploded, true);
  assert.deepEqual(page.state.tether[0],anchor);
  for (let i = 0; i < 440; i++) page.step();
  assert.equal(page.state.particles,32);
  page.faces(0); page.step(); assert.equal(page.state.particles,32);
  page.faces(1); page.step(); assert.equal(page.state.particles,32);
  landAll(page);page.reset(); for(let i=0;i<130;i++)page.step(); assert.equal(page.state.pressure, 0); assert.equal(page.state.particles, 0);
  assert.equal(page.state.tether.length,13);
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

test('效果內中文 UI（含動態按鈕及 shell 標籤）都有英文翻譯', () => {
  const i18n = fs.readFileSync(new URL('../../assets/i18n.js', import.meta.url), 'utf8');
  const context = { localStorage: { getItem: () => 'en' }, document: {
    createElement: () => ({ style: {} }), head: { append() {} }, addEventListener() {}, documentElement: {}, querySelectorAll: () => []
  } };
  context.window = context;
  vm.runInNewContext(i18n, context);
  const strings = [...source.matchAll(/(['"])((?:\\.|(?!\1).)*?)\1/g)].map(match => match[2]).filter(value => /[一-鿿]/.test(value));
  assert.ok(strings.length >= 18);
  assert.ok(strings.includes('充氣速度') && strings.includes('碎片飄落中…'));
  for (const value of strings) assert.notEqual(context.t(value), value, `缺翻譯：${value}`);
});

test('效果依賴僅引用存在的本地檔案', () => {
  assert.doesNotMatch(source, /https?:\/\//);
  for (const path of ['./physics.mjs', './balloon.mjs', './scene.mjs','./ground.mjs','./room.mjs','./bottle.png', '../../libs/mediapipe/vision_bundle.mjs', '../../libs/mediapipe/selfie_segmenter.tflite', '../../libs/mediapipe/blaze_face_short_range.tflite', '../../libs/mediapipe/wasm/vision_wasm_internal.wasm', '../../libs/mediapipe/wasm/vision_wasm_nosimd_internal.wasm']) {
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


test('透明貼圖只由有效前景延伸，不混入去背區的像素', () => {
  const pixels=new Uint8ClampedArray(5*5*4);
  for(let i=0;i<25;i++) pixels.set([0,255,0,0],i*4);
  pixels.set([180,110,80,255],(2*5+2)*4);
  fillTexture(pixels,5,5);
  for(let i=0;i<25;i++) assert.deepEqual([...pixels.slice(i*4,i*4+4)],[180,110,80,255]);
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

test('最大倍數只放大氣球並改變爆炸門檻，調參、失追與重置皆保持酒瓶場景', async () => {
  for(const max of [1.5,2.35,4]) {
    const state=physics.resetState();
    for(let i=0;i<12;i++) physics.pump(state,1);
    for(let i=0;i<240 && !state.exploded;i++) physics.advance(state,1/60,true,max);
    assert.equal(state.exploded,true); assert.ok(state.scale>=max*.985);
    assert.ok(Math.abs(state.scale-max)<.12);
  }
  const page=harness(); await settle(); page.step();
  const composition=page.scene,view=page.layout;
  for(let i=0;i<6;i++) page.button.click();
  const pressure=page.state.pressure;
  const widths=[];
  for(const max of [1.5,4,1.5]) {
    page.param('maxScale',max);
    assert.equal(page.state.pressure,pressure);
    assert.deepEqual(page.scene,composition); assert.deepEqual(page.layout,view);
    for(let i=0;i<90;i++) page.step();
    assert.deepEqual(page.scene,composition); assert.deepEqual(page.layout,view);
    widths.push(page.balloonWidth);
    page.faces(0); page.step(); page.faces(1); page.step();
    assert.deepEqual(page.scene,composition); assert.deepEqual(page.layout,view);
  }
  assert.ok(widths[1]>widths[0]*1.5 && widths[1]>widths[2]*1.5);
  assert.ok(Math.abs(page.state.scale-1.25)<.001);
  for(const max of [4,1.5]) {
    page.param('maxScale',max); page.reset();
    assert.equal(page.state.maxScale,max); assert.equal(page.state.pressure,0);
    assert.deepEqual(page.scene,composition); page.step();
    assert.deepEqual(page.scene,composition); assert.deepEqual(page.layout,view);
  }
  page.leave();
});

test('底部唯一按鈕爆炸後先吹風，即使沒有臉也能完成重置', async () => {
  const page=harness(); await settle(); page.step();
  assert.equal(page.extraButtons,0); assert.equal(page.button.textContent,'打氣');
  for(let i=0;i<12;i++) page.button.click();
  assert.equal(page.button.disabled,true);
  for(let i=0;i<120 && !page.state.exploded;i++) page.step();
  assert.equal(page.button.disabled,true); assert.equal(page.button.textContent,'碎片飄落中…');
  page.faces(0); page.step(); assert.equal(page.button.disabled,true);
  page.button.click();page.reset();assert.equal(page.state.resetElapsed,null);
  landAll(page);assert.equal(page.button.disabled,false);assert.equal(page.button.textContent,'重置');
  page.button.click(); assert.equal(page.state.particles,32);assert.equal(page.state.resetElapsed,0);assert.equal(page.button.disabled,true);
  for(let i=0;i<130;i++)page.step();assert.equal(page.state.pressure,0); assert.equal(page.state.particles,0);
  assert.equal(page.button.textContent,'打氣'); assert.equal(page.button.disabled,true);
  assert.equal(page.state.swing.angle,0); assert.equal(page.state.swing.previousX,null);
  page.faces(1); page.step(); assert.equal(page.button.disabled,false); page.leave();
});

test('近景構圖放大酒瓶與球，預設爆炸尺寸保留可見範圍', () => {
  for(const [width,height] of [[1280,665],[1280,609],[390,580],[844,390]]) {
    const view=sceneAPI.sceneLayout(width,height),tether=sceneAPI.createTether(view);
    assert.ok(view.bottleHeight>=view.unit*.28*1.5);
    const state={scale:physics.MAX_SCALE,pressure:1,velocity:0};
    for(let i=0;i<600;i++) {
      sceneAPI.advanceTether(tether,view,1/60,i*1000/60,{angle:0},false);
      const pose=sceneAPI.scenePose(view,tether,state);
      const top=pose.y-Math.cos(pose.angle)*pose.height/2-Math.hypot(Math.cos(pose.angle)*pose.height/2,Math.sin(pose.angle)*pose.width/2);
      assert.ok(top>20,`${width}×${height}: ${top}`);
      const cx=pose.x+Math.sin(pose.angle)*pose.height/2,rx=Math.hypot(Math.cos(pose.angle)*pose.width/2,Math.sin(pose.angle)*pose.height/2);
      assert.ok(cx-rx>0 && cx+rx<width);
      assert.ok(Math.abs(tether.points.at(-1).x-view.anchor.x)<view.ropeLength*.12);
      assert.ok(pose.y<view.bottleGround-view.bottleHeight-2);
      assert.equal(view.bottleGround,view.ground);
    }
  }
});

test('臉框經完整推論驅動球體鏡像左右移動，停止後阻尼回彈', async () => {
  const pages=[harness(),harness(),harness()];await settle();
  for(const page of pages) for(let i=0;i<60;i++)page.step();
  for(let i=1;i<=30;i++) {
    pages[0].faceX(35);pages[1].faceX(35+20*i/30);pages[2].faceX(35-20*i/30);
    pages.forEach(page=>page.step());
  }
  const center=page=>page.pose.x+Math.sin(page.pose.angle)*page.pose.height/2;
  const baseline=center(pages[0]),right=center(pages[1]),left=center(pages[2]);
  assert.ok(right<baseline-5,`相機右移應鏡像向左：${right-baseline}`);
  assert.ok(left>baseline+5,`相機左移應鏡像向右：${left-baseline}`);
  let crossed=false;
  for(let i=0;i<420;i++) {
    pages.forEach(page=>page.step());
    if(center(pages[1])>center(pages[0]))crossed=true;
  }
  assert.ok(crossed);assert.ok(Math.abs(center(pages[1])-center(pages[0]))<1);
  for(const page of pages) {
    const end=page.state.tether.at(-1),pose=page.pose;
    assert.ok(Math.hypot(pose.x-pose.knot*Math.sin(pose.angle)-end.x,pose.y+pose.knot*Math.cos(pose.angle)-end.y)<1e-8);
    page.leave();
  }
});

test('魚眼調參傳入球面渲染且保留氣量、尺寸、場景與追蹤', async () => {
  const page=harness();await settle();page.step();page.button.click();page.step();
  const before=page.state,scene=page.scene;
  for(const value of [0,1,.25]) {
    page.param('fisheye',value);
    assert.equal(page.renders.at(-1)[1],value);
    assert.equal(page.state.pressure,before.pressure);assert.equal(page.state.scale,before.scale);
    assert.equal(page.state.tracked,before.tracked);assert.deepEqual(page.scene,scene);
  }
  page.leave();
});

test('碎片完成最後一次微彈才即刻開放重置，失追及直接入口也不能提早清場', async () => {
  const page=harness();await settle();page.step();for(let i=0;i<12;i++)page.button.click();
  for(let i=0;i<120&&!page.state.exploded;i++)page.step();
  assert.equal(page.canReset,false);assert.equal(page.button.disabled,true);
  page.faces(0);let sawBounce=false,frames=0;
  while(!page.canReset && frames++<2000) {
    if(page.pieces.some(p=>p.bounces>0&&!p.landed))sawBounce=true;
    page.reset();assert.equal(page.state.resetElapsed,null);assert.equal(page.state.particles,32);
    page.button.disabled=false;page.button.click();assert.equal(page.state.resetElapsed,null);
    page.step();
    assert.equal(page.button.disabled,!page.canReset);
  }
  assert.ok(sawBounce);assert.equal(page.canReset,true);assert.ok(page.pieces.every(p=>p.landed));
  assert.equal(page.state.tracked,false);assert.equal(page.button.textContent,'重置');
  page.button.click();assert.equal(page.state.resetElapsed,0);page.step(2000);
  assert.equal(page.state.pressure,0);assert.equal(page.state.particles,0);page.leave();
});

test('靜止30秒維持垂直上浮，初始與重置沒有單向右偏', () => {
  const view=sceneAPI.sceneLayout(1280,665),tether=sceneAPI.createTether(view);
  assert.equal(tether.angle,0);assert.ok(tether.points.every(p=>p.x===view.anchor.x));
  let offset=0,peak=0;
  for(let i=0;i<1800;i++) {
    sceneAPI.advanceTether(tether,view,1/60,i*1000/60,physics.resetSwing(),false);
    const dx=tether.points.at(-1).x-view.anchor.x;offset+=dx;peak=Math.max(peak,Math.abs(dx));
    assert.ok(Math.abs(tether.angle)<.08);
  }
  assert.ok(Math.abs(offset/1800)<view.ropeLength*.03);assert.ok(peak<view.ropeLength*.08);
  assert.equal(sceneAPI.createTether(view).angle,0);
});

test('左右眼傾角經完整推論鏡像帶動球體，直頭回正、失追不沿用歪頭', async () => {
  const pages=[harness(),harness(),harness()];await settle();pages.forEach(p=>p.step());
  const eyes=angle=>[{x:.4,y:.4-Math.tan(angle)*.1},{x:.6,y:.4+Math.tan(angle)*.1}];
  pages[1].eyes(eyes(.3));pages[2].eyes(eyes(-.3));
  for(let i=0;i<120;i++)pages.forEach(p=>p.step());
  assert.ok(pages[1].state.swing.roll<-.25);assert.ok(pages[2].state.swing.roll>.25);
  assert.ok(pages[1].pose.angle<pages[0].pose.angle-.1);
  assert.ok(pages[2].pose.angle>pages[0].pose.angle+.1);
  pages.forEach(p=>p.eyes(eyes(0)));
  for(let i=0;i<600;i++)pages.forEach(p=>p.step());
  assert.ok(Math.abs(pages[1].pose.angle-pages[0].pose.angle)<.01);
  pages[1].eyes(eyes(.3));for(let i=0;i<60;i++)pages[1].step();
  pages[1].faces(0);pages[1].step();assert.equal(pages[1].state.swing.roll,0);
  pages[1].faces(1);pages[1].eyes(eyes(-.3));pages[1].step();assert.ok(pages[1].state.swing.roll>.25);
  pages.forEach(p=>p.leave());
});

test('歪頭正規化眼點還原寬高，慢推論低通、死區與異常資料保持有限', () => {
  const eyes=[{x:.4,y:.35},{x:.6,y:.45}],swing=physics.resetSwing();
  physics.trackRoll(swing,eyes,1,200,100);
  for(let i=1;i<=8;i++)physics.trackRoll(swing,eyes,1+i*400,200,100);
  assert.ok(Math.abs(swing.roll-(-Math.atan2(10,40)+.025))<.001);
  for(const bad of [undefined,null,{},[null,{}],[],[{x:NaN,y:.4},{x:.6,y:.4}],[{x:.5,y:.4},{x:.5,y:.5}]]) {
    physics.trackRoll(swing,bad,4000,200,100);assert.equal(swing.roll,0);assert.equal(swing.rollTime,null);
  }
  const jitter=[{x:.4,y:.4},{x:.6,y:.4005}];
  for(let i=0;i<120;i++)physics.trackRoll(swing,jitter,5000+i*16,200,100);
  assert.equal(swing.roll,0);
});

test('一秒推論間隔仍使用當前絕對歪頭，重獲反向眼角不沿用舊roll', async () => {
  const page=harness();await settle();
  page.eyes([{x:.4,y:.37},{x:.6,y:.43}]);page.step();assert.ok(page.state.swing.roll<-.25);
  for(let i=0;i<6;i++)page.step(1000);
  assert.ok(page.state.swing.roll<-.25);assert.ok(page.pose.angle<-.05);
  page.faces(0);page.step();assert.equal(page.state.swing.roll,0);
  page.faces(1);page.eyes([{x:.4,y:.43},{x:.6,y:.37}]);page.step(1000);
  assert.ok(page.state.swing.roll>.25);
  for(let i=0;i<12;i++)page.step(1000);
  assert.ok(page.pose.angle>.05);page.leave();
});

test('慢模型250至400ms仍經臉框驅動繩端，超過追蹤時限不套用舊位移', async () => {
  for(const interval of [250,400]) {
    const still=harness(),moving=harness();await settle();still.step();moving.step();
    for(let i=1;i<=4;i++) {
      moving.faceX(35+i*3);still.step(interval);moving.step(interval);
    }
    assert.ok(moving.state.swing.angle<-.01);
    assert.ok(moving.state.tether.at(-1).x<still.state.tether.at(-1).x);
    moving.faces(0);moving.step();moving.faces(1);moving.faceX(10);moving.step(900);
    assert.equal(moving.state.swing.angle,0);assert.equal(moving.state.swing.velocity,0);
    still.leave();moving.leave();
  }
  const swing=physics.resetSwing();physics.trackSwing(swing,50,100,100);
  physics.trackSwing(swing,55,1000,100);assert.equal(swing.velocity,0);
});

test('低FPS重置以真實前景兩秒完成，不受物理50ms步長拖慢', async () => {
  const page=harness();await settle();page.step();for(let i=0;i<12;i++)page.button.click();
  for(let i=0;i<120&&!page.state.exploded;i++)page.step();
  landAll(page);page.button.click();page.step(650);assert.ok(Math.abs(page.state.resetElapsed-.65)<1e-9);
  assert.equal(page.state.particles,32);assert.equal(page.pose,null);
  page.step(600);assert.ok(Math.abs(page.state.resetElapsed-1.25)<1e-9);
  page.step(750);assert.equal(page.state.resetElapsed,null);assert.equal(page.state.particles,0);
  assert.equal(page.state.exploded,false);assert.equal(page.state.pressure,0);page.leave();
});

test('落地後風重置保留碎片直到吹出，禁重入且失追、resize不提前生球', async () => {
  for(const lost of [false,true]) {
    const page=harness();await settle();page.step();
    for(let i=0;i<12;i++)page.button.click();
    for(let i=0;i<120&&!page.state.exploded;i++)page.step();
    if(lost)page.faces(0);landAll(page);
    const original=page.pieces.map(p=>p.gx);
    page.button.click();assert.equal(page.state.resetElapsed,0);assert.equal(page.state.particles,32);
    for(let i=0;i<15;i++)page.step(50);
    const elapsed=page.state.resetElapsed;page.reset();assert.equal(page.state.resetElapsed,elapsed);
    assert.equal(page.button.disabled,true);assert.equal(page.pose,null);
    assert.ok(page.pieces.every((p,i)=>p.gx>original[i] && p.height>0 && !p.landed && !p.settled));
    page.faces(0);page.resize(390,580);
    for(let i=0;i<20;i++)page.step(50);
    assert.equal(page.state.exploded,true);assert.equal(page.state.particles,32);assert.equal(page.pose,null);
    assert.ok(page.pieces.every(p=>groundAPI.shardPose(page.scene,p).x>page.scene.width));
    page.hide(true);page.step(2000);assert.equal(page.state.exploded,true);
    page.hide(false);for(let i=0;i<10;i++)page.step(50);
    assert.equal(page.state.resetElapsed,null);assert.equal(page.state.pressure,0);assert.equal(page.state.particles,0);
    assert.equal(page.button.textContent,'打氣');assert.equal(page.button.disabled,true);
    page.faces(1);page.step();assert.equal(page.button.disabled,false);page.leave();
  }
  const page=harness();await settle();page.step();for(let i=0;i<12;i++)page.button.click();
  for(let i=0;i<120&&!page.state.exploded;i++)page.step();
  landAll(page);page.button.click();page.step();page.leave();page.step(3000);
  assert.equal(page.state.resetElapsed,null);assert.equal(page.frames.size,0);assert.equal(page.state.particles,0);
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


test('五官裁切保留臉框內特徵、限制影像範圍並排除多餘髮頂', () => {
  const mask=new Float32Array(200*200).fill(1);
  for(const box of [{originX:70,originY:65,width:60,height:70},{originX:2,originY:2,width:70,height:80}]) {
    const head=physics.estimateHead(box,mask,200,200,200,200),face=head.face;
    assert.ok(face.left>=0 && face.top>=0 && face.right<=200 && face.bottom<=200);
    assert.ok(face.left<=box.originX && face.right>=box.originX+box.width);
    assert.ok(face.top<=box.originY && face.bottom>=box.originY+box.height);
    assert.ok(face.top>=head.top && face.right-face.left<head.right-head.left);
  }
});

test('實心球貼圖以有效前景RGB補滿所有alpha，不把背景綠色帶回球面', () => {
  const pixels=new Uint8ClampedArray(7*7*4);
  for(let i=0;i<49;i++) pixels.set([0,255,0,0],i*4);
  pixels.set([190,135,99,255],24*4);
  fillTexture(pixels,7,7);
  for(let i=0;i<49;i++) assert.deepEqual([...pixels.slice(i*4,i*4+4)],[190,135,99,255]);
});




test('主畫布只用酒瓶與球面碎片圖片，沒有街景、相機或人像圖層', async () => {
  const page=harness();await settle();page.step();
  const foreground=()=>page.drawSources.filter(source=>!page.sceneImages.includes(source));
  assert.deepEqual(foreground(),[page.ballCanvas]);
  page.faces(0);page.step();assert.deepEqual(foreground(),[page.ballCanvas]);
  page.faces(1);page.step();for(let i=0;i<12;i++)page.button.click();
  for(let i=0;i<120&&!page.state.exploded;i++)page.step();
  assert.equal(foreground().length,32);assert.ok(foreground().every(source=>source===foreground()[0]));
  assert.notEqual(foreground()[0],page.ballCanvas);
  const shadows=page.counts.balloonShadow;for(let i=0;i<10;i++)page.step();assert.equal(page.counts.balloonShadow,shadows);
  page.leave();
});

test('繩索固定酒瓶端點、維持段長與有限值，移頭帶動受限甩動', () => {
  const view=sceneAPI.sceneLayout(1280,665),tether=sceneAPI.createTether(view);
  let moved=0;
  for(let i=0;i<1200;i++) {
    sceneAPI.advanceTether(tether,view,1/60,i*1000/60,{angle:i<300?.3:i<600?-.3:0},false);
    assert.equal(tether.points[0].x,view.anchor.x);assert.equal(tether.points[0].y,view.anchor.y);
    for(let j=0;j<tether.points.length;j++) {
      const p=tether.points[j];for(const n of Object.values(p))assert.ok(Number.isFinite(n));
      if(j)assert.ok(Math.hypot(p.x-tether.points[j-1].x,p.y-tether.points[j-1].y)<view.ropeLength/12*1.04);
    }
    const end=tether.points.at(-1);assert.ok(Math.hypot(end.x-view.anchor.x,end.y-view.anchor.y)<=view.ropeLength*1.02);
    moved=Math.max(moved,Math.abs(end.x-view.anchor.x));
  }
  assert.ok(moved>view.ropeLength*.1);
  assert.ok(tether.points.at(-1).y<view.anchor.y-view.ropeLength*.15);
});

test('氣球爆炸失去浮力後繩索回落，重置回復上浮初始姿態', () => {
  const view=sceneAPI.sceneLayout(390,844),tether=sceneAPI.createTether(view);
  for(let i=0;i<180;i++)sceneAPI.advanceTether(tether,view,1/60,i*1000/60,{angle:0},false);
  const high=tether.points.at(-1).y;
  for(let i=0;i<360;i++)sceneAPI.advanceTether(tether,view,1/60,(i+180)*1000/60,{angle:0},true);
  assert.ok(tether.points.at(-1).y>high+view.ropeLength*.2);
  assert.ok(tether.points.at(-1).y<=view.ground);
  assert.deepEqual(tether.points[0],{x:view.anchor.x,y:view.anchor.y,px:view.anchor.x,py:view.anchor.y});
  const reset=sceneAPI.createTether(view);assert.ok(reset.points.at(-1).y<view.anchor.y-view.ropeLength*.35);
});

test('桌面與手機初始球瓶均可見，最大尺寸只影響球面，繩頂精確連結', () => {
  for(const [width,height] of [[1280,665],[390,844],[844,390]]) {
    const view=sceneAPI.sceneLayout(width,height),tether=sceneAPI.createTether(view),snapshot=JSON.stringify(view);
    const first=sceneAPI.scenePose(view,tether,physics.resetState());
    assert.ok(first.y-first.height>30 && first.x-first.width/2>0 && first.x+first.width/2<width);
    assert.ok(view.ground<=height-110 && view.bottleHeight>25);
    for(const scale of [1.5,4,1.5]) {
      const pose=sceneAPI.scenePose(view,tether,{scale,pressure:.5,velocity:0}),end=tether.points.at(-1);
      assert.ok(Math.abs(pose.x-pose.knot*Math.sin(pose.angle)-end.x)<1e-9);
      assert.ok(Math.abs(pose.y+pose.knot*Math.cos(pose.angle)-end.y)<1e-9);
      assert.equal(JSON.stringify(view),snapshot);
      assert.ok(pose.width>first.width);
    }
  }
});


test('共享地面投影深度縮小，空中位置反推再投影與爆炸前對齊', () => {
  const view=sceneAPI.sceneLayout(1280,665);
  for(const z of [-.2,0,.5]) for(const angle of [-.4,0,.4]) {
    const pose=sceneAPI.scenePose(view,sceneAPI.createTether(view),{scale:2.3,pressure:.9,velocity:0});
    const piece={x:pose.x+Math.sin(angle)*pose.height/2,y:pose.y-Math.cos(angle)*pose.height/2,
      vx:180,vy:-100,phase:.5,width:pose.width};
    const placed=groundAPI.placeShard(view,piece,z),p=groundAPI.shardPose(view,placed);
    assert.ok(Math.hypot(p.x-piece.x,p.y-piece.y)<1e-9);assert.ok(Math.abs(p.size-1)<1e-9);
  }
  assert.ok(groundAPI.projectGround(view,0,.5).scale<groundAPI.projectGround(view,0,0).scale);
  assert.deepEqual(groundAPI.projectGround(view,0,0),{x:view.x,y:view.ground,scale:1});
});

test('氣球輪廓投影隨位置大小高度角度改變，預設跨牆地且距離控制柔化', () => {
  const view=sceneAPI.sceneLayout(1280,665),pose=sceneAPI.scenePose(view,sceneAPI.createTether(view),physics.resetState());
  const shadow=groundAPI.balloonShadow(view,pose);
  assert.deepEqual(shadow.map(s=>s.surface),['floor','right']);
  const center=shadows=>shadows.flatMap(s=>s.points).reduce((sum,p,i,points)=>sum+p.x/points.length,0);
  assert.ok(center(groundAPI.balloonShadow(view,{...pose,x:pose.x+45}))>center(shadow));
  assert.ok(center(groundAPI.balloonShadow(view,{...pose,angle:.3}))>center(shadow));
  for(const change of [{width:pose.width*1.5},{y:pose.y-60}]) assert.notDeepEqual(groundAPI.balloonShadow(view,{...pose,...change}),shadow);
  for(const s of shadow) {
    assert.equal(s.opacity,.30/(1+s.distance*.30));assert.equal(s.blur,(.7+s.distance*1.4)*view.unit/350);
  }
});

test('32片分散於地板，30/60/120fps落地微彈後停止且不穿地', () => {
  const view=sceneAPI.sceneLayout(1280,665);
  const run=fps=>Array.from({length:32},(_,i)=>{
    const initial={x:view.x+(i-16)*3,y:view.ground-200-(i%5)*25,width:200,
      vx:(i-16)*12,vy:-120+(i%7)*35,angle:i*.27,flip:0,tilt:0,
      flipSpeed:3+i%3,tiltSpeed:1.3,spin:1.2,drag:.8+(i%4)*.2,phase:i*.7,age:0};
    const piece=groundAPI.placeShard(view,initial,(i%5-2)*.02);
    for(let frame=0;frame<fps*25;frame++) {
      groundAPI.advanceGroundShard(piece,1/fps,view);
      assert.ok(piece.height>=0);assert.ok(Object.values(piece).filter(v=>typeof v==='number').every(Number.isFinite));
    }
    assert.equal(piece.height,0);assert.equal(piece.landed,true);assert.equal(piece.settled,true);
    assert.equal(piece.vh,0);assert.equal(piece.gvx,0);assert.equal(piece.gvz,0);
    assert.ok(piece.gz>=view.nearDepth && piece.gz<=view.farDepth);
    const before=JSON.stringify({...piece,age:0});groundAPI.advanceGroundShard(piece,1,view);
    assert.equal(JSON.stringify({...piece,age:0}),before);
    return piece;
  });
  const slow=run(30),normal=run(60),fast=run(120);
  for(let i=0;i<32;i++) for(const result of [slow,normal]) {
    assert.ok(Math.hypot(result[i].gx-fast[i].gx,result[i].gz-fast[i].gz)<.002);
  }
  assert.ok(new Set(fast.map(p=>p.gz.toFixed(2))).size>8);
  assert.ok(new Set(fast.map(p=>groundAPI.projectGround(view,p.gx,p.gz).y.toFixed(0))).size>8);
});

test('爆後長時間仍保留所有落片，重置一次清除', async () => {
  const page=harness();await settle();page.step();for(let i=0;i<12;i++) page.button.click();
  for(let i=0;i<120&&!page.state.exploded;i++)page.step();
  const frozenHeight=page.pieces[0].textureHeight;
  for(let i=0;i<750;i++)page.step(50);
  assert.equal(page.state.particles,32);assert.ok(page.pieces.every(piece=>piece.settled && piece.height===0));
  assert.ok(page.pieces.every(piece=>piece.textureHeight>20));
  assert.equal(page.drawnImageSizes.length,33);
  assert.ok(page.drawnImageSizes.every(([w,h])=>w>0 && h>20),'落地高度歸零不能讓drawImage貼圖高度也歸零');
  assert.equal(page.drawnImageSizes.filter(([,h])=>h===frozenHeight).length,32,'32片保留爆炸當下貼圖高度');
  page.reset();assert.equal(page.state.particles,32);for(let i=0;i<130;i++)page.step();assert.equal(page.state.particles,0);page.leave();
});

test('酒瓶圖失敗會清楚提示並釋放GPU及相機，正常離頁也釋放素材', async () => {
  const broken=harness({assetFailed:true});await settle();
  assert.match(broken.errors[0],/酒瓶素材載入失敗/);assert.equal(broken.state.stopped,true);
  assert.equal(broken.counts.assets,1);assert.equal(broken.counts.balloon,1);assert.ok(broken.counts.tracks>=1);
  const normal=harness();await settle();normal.leave();assert.equal(normal.counts.assets,1);
});

test('本地場景圖載入失敗、完成及途中釋放都不保留事件或來源', async () => {
  for(const mode of ['ready','error','release']) {
    const images=[],document={createElement(){const image={removeAttribute(name){delete this[name];}};images.push(image);return image;}};
    const assets=sceneAPI.createSceneAssets(document),completion=assets.ready.catch(error=>error);
    if(mode==='ready') {images.forEach(image=>image.onload());await completion;assert.equal(assets.bottle,images[0]);assert.equal(images.length,1);assert.equal(images[0].src,'./bottle.png');}
    if(mode==='error') {images[0].onerror();assert.ok(await completion instanceof Error);}
    assets.release();assert.ok(await completion===undefined || mode!=='ready');
    assert.equal(assets.bottle,null);
    assert.ok(images.every(image=>image.onload===null && image.onerror===null && image.src===undefined));
  }
});

test('房間與地板共用投影，瓶底綁點校準且落片位置在有限地板內', () => {
  for(const [width,height] of [[1280,665],[390,844],[844,390]]) {
    const view=sceneAPI.sceneLayout(width,height);
    assert.equal(view.bottleGround,view.ground);
    assert.equal(view.anchor.x,view.x);
    assert.equal(view.anchor.y,view.bottleGround+(sceneAPI.BOTTLE.neckY-sceneAPI.BOTTLE.bottom)*view.bottleScale);
    assert.ok(Math.abs(view.anchor.y-view.baseRopeLength-(view.ground-view.unit*(.44*825/1464+.22)))<1e-8);
    for(const z of [view.nearDepth,0,view.farDepth]) for(const x of [-roomAPI.roomHalfWidth(z)+.1,0,roomAPI.roomHalfWidth(z)-.1]) {
      const p=groundAPI.projectGround(view,x,z);
      assert.deepEqual(p,roomAPI.projectPoint(view,x,z));
      const hit=roomAPI.rayHit(view,{x,z,height:.1},{x:0,z:0,height:-1});assert.equal(hit.surface,'floor');
    }
  }
});

test('有限兩牆與地板射線取最近正命中，平行、開口與面外不命中', () => {
  const view=sceneAPI.sceneLayout(1280,665);
  assert.deepEqual(roomAPI.roomSurfaces(view).map(s=>s.id),['floor','left','right']);
  const hit=roomAPI.rayHit(view,{x:0,z:0,height:.2},{x:.1,z:.1,height:-1});
  assert.equal(hit.surface,'floor');assert.ok(Math.abs(hit.t-.2)<1e-10);
  const wall=roomAPI.rayHit(view,{x:0,z:0,height:1},{x:1,z:.5,height:0});assert.equal(wall.surface,'right');
  const entering=roomAPI.rayHit(view,{x:-3,z:-1,height:1},{x:1,z:0,height:0});assert.equal(entering.surface,'left');
  assert.equal(roomAPI.rayHit(view,{x:0,z:0,height:1},{x:0,z:-1,height:0}),null);
  assert.equal(roomAPI.rayHit(view,{x:0,z:0,height:3},{x:0,z:1,height:0}),null);
  assert.equal(roomAPI.rayHit(view,{x:0,z:0,height:1},{x:0,z:0,height:0}),null);
});

test('球影由同一光錐裁到有限接收面，接縫連續且沒有重複的較遠命中', () => {
  for(const [width,height] of [[1280,665],[390,580],[844,390]]) {
    const view=sceneAPI.sceneLayout(width,height),pose=sceneAPI.scenePose(view,sceneAPI.createTether(view),{scale:1.6,pressure:.5,velocity:0});
    const shadows=groundAPI.balloonShadow(view,pose);assert.equal(shadows.length,2);
    const floor=shadows.find(s=>s.surface==='floor'),wall=shadows.find(s=>s.surface!=='floor');
    assert.ok(floor && wall);
    for(const shadow of shadows)for(const point of shadow.world) {
      const light=roomAPI.ROOM_LIGHT,direction={x:point.x-light.x,z:point.z-light.z,height:point.height-light.height};
      const hit=roomAPI.rayHit(view,light,direction);assert.ok(hit);assert.ok(Math.abs(hit.t-1)<1e-7);
    }
    const seam=floor.world.filter(p=>Math.abs(p.z+Math.abs(p.x)*roomAPI.WALL_SLOPE-roomAPI.ROOM_BACK)<1e-7);
    assert.ok(seam.length>=2);
    for(const point of seam)assert.ok(wall.world.some(p=>Math.hypot(p.x-point.x,p.z-point.z,p.height-point.height)<1e-7));
  }
});

test('主色自動產生不同牆面與暖奶油地板，黑白灰保持可辨且一致', () => {
  for(const color of ['#63b7ac','#ef8c76','#808080','#000000','#ffffff']) {
    const palette=roomAPI.roomPalette(color);assert.deepEqual(palette,roomAPI.roomPalette(color));
    assert.ok(palette.right.l>palette.left.l+.1);assert.ok(palette.floor.l>palette.left.l);
    assert.equal(palette.floor.h,45);assert.ok(Object.values(palette).every(c=>Object.values(c).every(Number.isFinite)));
    if(['#808080','#000000','#ffffff'].includes(color))assert.ok(Object.values(palette).every(c=>c.s===0));
  }
});

test('兩面牆與有限地板填滿四種視窗，中央牆角與斜地腳同源', () => {
  const inside=(points,x,y)=>{
    let result=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[i],b=points[j];
      if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)result=!result;
    }
    return result;
  };
  for(const [w,h] of [[1280,665],[1280,609],[390,580],[844,390]]) {
    const view=sceneAPI.sceneLayout(w,h),polygons=roomAPI.roomSurfaces(view).map(surface=>surface.points.map(p=>roomAPI.projectPoint(view,p.x,p.z,p.height)));
    for(const x of [1,w*.2,w*.499,w*.8,w-1])for(const y of [1,h*.3,h*.7,h-1])assert.equal(polygons.filter(points=>inside(points,x,y)).length,1);
    const corner=roomAPI.projectPoint(view,0,roomAPI.ROOM_BACK,0);
    assert.equal(corner.x,w/2);assert.ok(corner.y<view.ground-20);
  }
});

test('繩長倍率重新約束原節點並保留氣量、尺寸、落地門檻與風吹階段', async () => {
  const page=harness();await settle();page.step();for(let i=0;i<6;i++)page.button.click();for(let i=0;i<90;i++)page.step();
  const pressure=page.state.pressure,scale=page.state.scale,width=page.balloonWidth,bottle=page.scene.bottleHeight;
  for(const multiplier of [.6,1.5,1]) {
    page.param('ropeScale',multiplier);page.param('background','#ef8c76');
    assert.equal(page.state.pressure,pressure);assert.equal(page.state.scale,scale);assert.equal(page.balloonWidth,width);
    assert.equal(page.scene.bottleHeight,bottle);assert.equal(page.scene.ropeLength,page.scene.baseRopeLength*multiplier);
    const points=page.state.tether,total=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
    assert.ok(Math.abs(total-page.scene.ropeLength)<page.scene.ropeLength*.03);
  }
  for(let i=0;i<6;i++)page.button.click();for(let i=0;i<120&&!page.state.exploded;i++)page.step();
  page.param('ropeScale',.6);assert.equal(page.state.particles,32);assert.equal(page.canReset,false);
  landAll(page);page.param('ropeScale',1.5);assert.equal(page.canReset,true);assert.equal(page.state.particles,32);
  page.button.click();page.step(500);const elapsed=page.state.resetElapsed;
  page.param('ropeScale',.6);page.resize(390,580);assert.equal(page.state.resetElapsed,elapsed);
  assert.equal(page.state.particles,32);assert.equal(page.scene.ropeLength,page.scene.baseRopeLength*.6);
  page.step(1500);assert.equal(page.state.resetElapsed,null);assert.equal(page.state.pressure,0);page.leave();
});

test('短繩左右歪頭時酒瓶先畫，完整繩球同在前景且調色不改球材質', async () => {
  const page=harness();await settle();page.step();page.param('ropeScale',.6);
  for(const angle of [-.3,.3]) {
    page.eyes([{x:.4,y:.4-Math.tan(angle)*.1},{x:.6,y:.4+Math.tan(angle)*.1}]);
    for(let i=0;i<60;i++)page.step();
    const ops=page.drawOps,bottle=ops.findIndex(o=>o.source===page.sceneImages[0]),rope=ops.findIndex(o=>o.type==='stroke'&&o.color==='#776a55'),ball=ops.findIndex(o=>o.source===page.ballCanvas);
    assert.ok(bottle>=0 && rope>bottle && ball>rope);
    assert.deepEqual(page.renders.at(-1),[page.state.pressure,page.state.fisheye]);
  }
  page.leave();
});
