import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as physics from './physics.mjs';

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

test('頂緣找頭髮、下巴收窄，分離遮罩不重疊且保留身體 alpha', () => {
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
  for (let i = 0; i < data.length; i++) {
    assert.equal(body[i * 4 + 3] + hair[i * 4 + 3], data[i] * 255);
    assert.ok(body[i * 4 + 3] === 0 || hair[i * 4 + 3] === 0);
  }
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
  const events = {}, documentEvents = {}, elements = [], timers = new Map(), frames = new Map();
  const counts = { mask: 0, segmenter: 0, detector: 0, tracks: 0, infer: 0, detect: 0 };
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
        drawImage(...args) { el.draws.push(args); }, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
        createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
        putImageData() {}
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
  let reset;
  const context = {
    ...physics, modelAPI, console: { error() {} }, t: x => x,
    document: { hidden: false, createElement: element,
      addEventListener(key, fn) { documentEvents[key] = fn; }, removeEventListener(key) { delete documentEvents[key]; } },
    Shell: { init() { return {
      container, addParam(config) { config.onChange(config.value); },
      addButton(config) { reset = config.onClick; }, showLoading() {}, hideLoading() {}, showError(msg) { errors.push(msg); }
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
  vm.runInContext(source.replace(/^import[^\n]+\n/, '').replace("import('../../libs/mediapipe/vision_bundle.mjs')", 'Promise.resolve(modelAPI)'), sandbox);
  return {
    counts, timers, frames, errors, stream, segmenter, detector,
    get button() { return elements.find(el => el.className === 'exploding-pump'); },
    get status() { return elements.find(el => el.className === 'exploding-status').textContent; },
    get drawCount() { return elements.find(el => el.className === 'exploding-stage').draws.length; },
    get state() { return vm.runInContext('({ ...state, tracked, ready, stopped, particles: particles.length })', sandbox); },
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
    reset() { reset(); },
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
  assert.equal(page.state.exploded, true); assert.equal(page.state.particles, 49);
  page.faces(0); page.step();
  assert.equal(page.state.tracked, false); assert.match(page.status, /追蹤遺失/);
  page.faces(1); page.step(); assert.equal(page.state.exploded, true);
  for (let i = 0; i < 240; i++) page.step();
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
  assert.equal(page.counts.segmenter, 1); assert.equal(page.counts.detector, 1); assert.equal(page.counts.tracks, 1);
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
  for (const path of ['./physics.mjs', '../../libs/mediapipe/vision_bundle.mjs', '../../libs/mediapipe/selfie_segmenter.tflite', '../../libs/mediapipe/blaze_face_short_range.tflite', '../../libs/mediapipe/wasm/vision_wasm_internal.wasm', '../../libs/mediapipe/wasm/vision_wasm_nosimd_internal.wasm']) {
    assert.ok(fs.existsSync(new URL(path, import.meta.url)), path);
  }
});
