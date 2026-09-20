import test from 'node:test';
import assert from 'node:assert/strict';
import { createSprayAudio } from './audio.mjs';
import { canSpray } from './core.mjs';

function fixture(navigator = { audioSession: { type: 'auto' } }) {
  let context;
  const status = [];
  const state = { paired: true, calibrated: true, held: true, visible: true, sensorAt: 100, pulseAt: 100 };
  class Audio {
    constructor() { context = this; this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 16; this.resumes = 0; }
    createGain() {
      this.gain = { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } };
      return { gain: this.gain, connect() {} };
    }
    createBuffer() { return { getChannelData: () => new Float32Array(32) }; }
    createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    createBiquadFilter() { return { frequency: {}, connect() {} }; }
    resume() {
      this.resumes++;
      return new Promise((resolve, reject) => {
        this.finish = () => { this.change('running'); resolve(); };
        this.fail = () => reject(new Error('blocked'));
      });
    }
    change(state) { this.state = state; this.onstatechange?.(); }
    suspend() { this.change('suspended'); return Promise.resolve(); }
    close() { this.change('closed'); return Promise.resolve(); }
  }
  const audio = createSprayAudio({ Audio, navigator, canPlay: () => canSpray(state, 100), onStatus: value => status.push(value) });
  return { audio, state, status, navigator, get context() { return context; } };
}

test('可噴漆時輸出 .14，放開立即歸零', async () => {
  const f = fixture(), ready = f.audio.prepare();
  assert.equal(f.context.resumes, 1);
  f.context.finish(); await ready;
  assert.equal(f.context.gain.value, .14);
  f.state.held = false; f.audio.sync();
  assert.equal(f.context.gain.value, 0);
  f.audio.dispose();
});

for (const reason of ['held', 'visible', 'paired']) {
  test(`resume 晚到，${reason} 失效後不能補播`, async () => {
    const f = fixture(), ready = f.audio.prepare();
    f.state[reason] = false; f.audio.sync();
    if (reason === 'visible') f.audio.suspend();
    f.context.finish(); await ready;
    assert.equal(f.context.gain.value, 0);
    assert.equal(f.context.resumes, 1);
    f.audio.dispose();
  });
}

test('靜音在 pending resume 與後續 prepare 之間保持，不偷開音效', async () => {
  const f = fixture(), ready = f.audio.prepare();
  await f.audio.setMuted(true);
  f.context.finish(); await ready; await f.audio.prepare();
  assert.equal(f.context.gain.value, 0);
  assert.equal(f.context.resumes, 1);
  assert.equal(f.status.at(-1), 'muted');
  const unmute = f.audio.setMuted(false);
  f.context.finish(); await unmute;
  assert.equal(f.context.gain.value, .14);
  f.audio.dispose();
});

test('音效中斷時立即歸零，沒有背景 resume，手勢重試可恢復', async () => {
  const f = fixture(), ready = f.audio.prepare();
  f.context.finish(); await ready;
  f.context.change('interrupted');
  assert.equal(f.context.gain.value, 0);
  assert.equal(f.status.at(-1), 'retry');
  assert.equal(f.context.resumes, 1);
  const retry = f.audio.prepare(); f.context.finish(); await retry;
  assert.equal(f.context.gain.value, .14);
  f.audio.dispose();
});

test('resume 拒絕有重試狀態，重試後仍檢查當下 held', async () => {
  const f = fixture(), ready = f.audio.prepare();
  f.context.fail(); await ready;
  assert.equal(f.status.at(-1), 'retry');
  assert.equal(f.context.gain.value, 0);
  const retry = f.audio.prepare(); f.state.held = false; f.context.finish(); await retry;
  assert.equal(f.context.gain.value, 0);
  f.audio.dispose();
});

test('舊 resume 未完成仍可透過新手勢重試，晚到的拒絕不覆蓋成功狀態', async () => {
  const f = fixture(), first = f.audio.prepare();
  const rejectFirst = f.context.fail;
  const retry = f.audio.prepare();
  assert.equal(f.context.resumes, 2);
  f.context.finish(); await retry;
  rejectFirst(); await first;
  assert.equal(f.context.gain.value, .14);
  assert.equal(f.status.at(-1), 'ready');
  f.audio.dispose();
});

test('dispose 後晚到的 resume 不復活，也不再更新提示', async () => {
  const f = fixture(), ready = f.audio.prepare();
  f.audio.dispose(); const count = f.status.length;
  f.context.finish(); await ready; await f.audio.prepare();
  assert.equal(f.context.gain.value, 0);
  assert.equal(f.context.resumes, 1);
  assert.equal(f.status.length, count);
  assert.equal(f.navigator.audioSession.type, 'auto');
});

test('audioSession 只在手勢 prepare 切 playback，dispose 不干預新擁有者', async () => {
  const navigator = { audioSession: { type: 'ambient' } };
  const first = fixture(navigator);
  assert.equal(navigator.audioSession.type, 'ambient');
  const ready = first.audio.prepare(); first.context.finish(); await ready;
  assert.equal(navigator.audioSession.type, 'playback');
  first.audio.dispose(); assert.equal(navigator.audioSession.type, 'ambient');
  const older = fixture(navigator), newer = fixture(navigator);
  const a = older.audio.prepare(), b = newer.audio.prepare();
  older.context.finish(); newer.context.finish(); await Promise.all([a, b]);
  older.audio.dispose(); assert.equal(navigator.audioSession.type, 'playback');
  navigator.audioSession.type = 'transient'; newer.audio.dispose();
  assert.equal(navigator.audioSession.type, 'transient');
});

test('沒有或拒絕 audioSession API 仍能播放', async () => {
  for (const navigator of [{}, { get audioSession() { throw new Error('unsupported'); } }]) {
    const f = fixture(navigator), ready = f.audio.prepare();
    f.context.finish(); await ready;
    assert.equal(f.context.gain.value, .14); f.audio.dispose();
  }
});
