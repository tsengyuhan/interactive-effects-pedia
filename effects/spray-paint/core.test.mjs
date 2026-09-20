import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { orientationFrame, aimFromFrames, validPacket, HostState, canSpray, parsePairing, importKey, encryptPacket, decryptPacket, PAINT_TTL, LINK_TTL } from './core.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const frame = (alpha = 0, beta = 90, gamma = 0) => orientationFrame({ alpha, beta, gamma });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
const session = 'a'.repeat(32), nonce = 'b'.repeat(32), beat = 'c'.repeat(32);
const hello = { v: 1, type: 'hello', session, nonce, seq: 1 };
const packet = { ...hello, type: 'state', seq: 2, beat, x: .25, y: .7, color: '#EF4939', pressed: true, calibrated: true };

test('直立初始與跨越 beta=90 保持連續，任意重新置中回中央', () => {
  const origin = frame();
  const center = aimFromFrames(origin, origin);
  near(center.x, .5); near(center.y, .5);
  const down = aimFromFrames(origin, frame(0, 89.9));
  const up = aimFromFrames(origin, frame(0, 90.1));
  near(down.x, up.x); assert.ok(down.y > .5 && up.y < .5);
  assert.ok(down.y - up.y < .003);
  const tilted = frame(82, 114, -14);
  const recentered = aimFromFrames(tilted, tilted);
  near(recentered.x, .5); near(recentered.y, .5);
});
test('yaw 左右與 pitch 上下獨立，359→0 不跳躍', () => {
  const origin = frame();
  assert.ok(aimFromFrames(origin, frame(10)).x < .5);
  assert.ok(aimFromFrames(origin, frame(350)).x > .5);
  assert.ok(aimFromFrames(origin, frame(0, 100)).y < .5);
  assert.ok(aimFromFrames(origin, frame(0, 80)).y > .5);
  near(aimFromFrames(frame(359), frame(0)).x, .5 - 1 / 90);
  near(aimFromFrames(frame(0), frame(359)).x, .5 + 1 / 90);
  assert.equal(aimFromFrames(origin, frame(90), 2).x, 0);
});
test('缺少、無限或超界感測資料不可變成有效方向', () => {
  for (const alpha of [null, undefined, NaN, Infinity, '0', -1, 361]) assert.equal(orientationFrame({ alpha, beta: 90, gamma: 0 }), null);
  assert.equal(frame(0, 181), null); assert.equal(frame(0, 90, 91), null);
  assert.equal(aimFromFrames(null, frame()), null);
});
test('封包僅接受有限 XY、正確布林、序號、色碼及識別碼', () => {
  assert.ok(validPacket(hello)); assert.ok(validPacket(packet));
  for (const change of [{ x: NaN }, { x: Infinity }, { x: -1 }, { y: 1.01 }, { color: 'red' }, { color: '#fff' }, { pressed: 1 }, { calibrated: null }, { seq: 0 }, { seq: 1.5 }, { seq: Number.MAX_SAFE_INTEGER + 1 }, { session: 'bad' }, { nonce: null }, { beat: 7 }, { type: 'unknown' }])
    assert.equal(validPacket({ ...packet, ...change }), false, JSON.stringify(change));
});
test('配對僅容許一個控制器，拒絕 retained、重播、舊 nonce 與過期心跳', () => {
  const host = new HostState(nonce); host.issue(beat, 100);
  assert.equal(host.accept(packet, 101), false);
  assert.equal(host.accept(hello, 101, true), false);
  assert.ok(host.accept(hello, 101));
  assert.equal(host.accept({ ...hello, session: 'd'.repeat(32) }, 102), false);
  assert.ok(host.accept(packet, 110)); assert.ok(host.pressed);
  assert.equal(host.accept(packet, 120), false);
  assert.equal(host.accept({ ...packet, seq: 3, nonce: 'f'.repeat(32) }, 120), false);
  assert.equal(host.accept({ ...packet, seq: 3, beat: 'f'.repeat(32) }, 120), false);
  assert.equal(host.accept({ ...packet, seq: 3 }, 100 + PAINT_TTL + 1), false);
});
test('失聯約一秒停噴、數秒釋放；重新連線不承接舊噴漆', () => {
  const host = new HostState(nonce); host.issue(beat, 0); host.accept(hello, 0); host.accept(packet, 1);
  assert.equal(host.tick(PAINT_TTL + 2), false); assert.equal(host.pressed, false); assert.equal(host.calibrated, false);
  assert.equal(host.tick(LINK_TTL + 2), true);
  host.reset('d'.repeat(32));
  assert.equal(host.session, null); assert.equal(host.pressed, false);
  assert.equal(host.accept({ ...packet, seq: 3 }, LINK_TTL + 3), false);
  assert.equal(host.accept(hello, LINK_TTL + 3), false);
});
test('未對位、放開、背景、感測逾時或斷線都不能噴漆', () => {
  const state = { paired: true, calibrated: true, held: true, visible: true, sensorAt: 900, pulseAt: 900 };
  assert.ok(canSpray(state, 1000));
  for (const key of ['paired', 'calibrated', 'held', 'visible']) assert.equal(canSpray({ ...state, [key]: false }, 1000), false);
  assert.equal(canSpray({ ...state, sensorAt: 0 }, 1000), false);
  assert.equal(canSpray({ ...state, pulseAt: 0 }, 1000), false);
  const host = new HostState(nonce); host.issue(beat, 0); host.accept(hello, 0);
  host.accept({ ...packet, calibrated: false }, 1); assert.equal(host.pressed, false);
});
test('配對鍵只從合法 fragment 讀取，AES-GCM 每次 IV 獨立且拒絕竄改或大封包', async () => {
  const hex = 'ab'.repeat(32), key = await importKey(hex);
  assert.deepEqual(parsePairing(`#room=${session}&key=${hex}`), { room: session, key: hex });
  assert.equal(parsePairing(`#room=short&key=${hex}`), null);
  assert.equal(parsePairing(`?room=${session}&key=${hex}`), null);
  const a = await encryptPacket(key, packet), b = await encryptPacket(key, packet);
  assert.notDeepEqual(a.slice(0, 12), b.slice(0, 12));
  assert.deepEqual(await decryptPacket(key, a), packet);
  a[20] ^= 1;
  assert.equal(await decryptPacket(key, a), null);
  assert.equal(await decryptPacket(key, new Uint8Array(4097)), null);
  assert.equal(await decryptPacket(await importKey('cd'.repeat(32)), b), null);
});
test('效果模組所有 t 字串及狀態訊息均有英文翻譯', () => {
  const el = () => ({ style: {}, append() {}, addEventListener() {} });
  const ctx = { localStorage: { getItem: () => 'en' }, document: { createElement: el, head: { append() {} }, addEventListener() {} } };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(new URL('../../assets/i18n.js', import.meta.url), 'utf8'), ctx);
  const missing = [];
  for (const name of readdirSync(new URL('.', import.meta.url)).filter(n => /\.(?:js|mjs)$/.test(n) && !n.endsWith('.test.mjs'))) {
    const src = readFileSync(new URL(name, import.meta.url), 'utf8');
    for (const match of src.matchAll(/(?:\bt|\buncalibrate)\('([^']*[\u4e00-\u9fff][^']*)'\)/g))
      if (ctx.t(match[1]) === match[1]) missing.push(`${name}: ${match[1]}`);
  }
  assert.deepEqual(missing, []);
});
