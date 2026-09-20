import test from 'node:test';
import assert from 'node:assert/strict';
import { importKey, encryptPacket, decryptPacket } from './core.mjs';
import { connectRelay } from './relay.mjs';

test('傳輸拒絕 retained，停止覆蓋加密中噴漆，斷線與關閉不補送', async () => {
  const handlers = new Map(), publishes = [];
  let ready = 0, lost = 0, received = 0, closed = false, subscribed;
  const client = {
    connected: true,
    on(name, callback) { handlers.set(name, callback); },
    subscribe(topic, options, callback) { subscribed = { topic, options, callback }; },
    publish(topic, bytes, options) { publishes.push({ topic, bytes, options }); },
    end(force) { closed = force; }
  };
  const previous = globalThis.window;
  const room = 'a'.repeat(32), session = 'b'.repeat(32), nonce = 'c'.repeat(32), beat = 'd'.repeat(32);
  const key = await importKey('ef'.repeat(32));
  globalThis.window = { mqtt: { connect(url, options) {
    assert.equal(url, 'wss://broker.hivemq.com:8884/mqtt');
    assert.equal(options.clean, true); assert.equal(options.queueQoSZero, false);
    return client;
  } } };
  let relay;
  try {
    relay = connectRelay({ room, key, controller: true, onReady: () => ready++, onLost: () => lost++, onPacket: () => received++ });
    const state = { v: 1, type: 'state', session, nonce, beat, seq: 1, x: .3, y: .4, color: '#ef4939', calibrated: true, pressed: true };
    await relay.send(state); assert.equal(publishes.length, 0);
    handlers.get('connect')(); subscribed.callback(null, [{ qos: 0 }]); assert.equal(ready, 1);
    await relay.send(state);
    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].topic, `interactia/spray/v1/${room}/controller`);
    assert.deepEqual(publishes[0].options, { qos: 0, retain: false });
    assert.deepEqual(await decryptPacket(key, publishes[0].bytes), state);

    const painting = relay.send({ ...state, seq: 2 });
    const stopped = relay.send({ ...state, seq: 3, pressed: false });
    await Promise.all([painting, stopped]); assert.equal(publishes.length, 1);
    await relay.send({ ...state, seq: 4, pressed: false });
    assert.equal((await decryptPacket(key, publishes[1].bytes)).pressed, false);

    const incoming = `interactia/spray/v1/${room}/host`;
    const bytes = await encryptPacket(key, { v: 1, type: 'pulse', session, nonce, seq: 1, beat, target: null });
    await handlers.get('message')(incoming, bytes, { retain: true }); assert.equal(received, 0);
    await handlers.get('message')(incoming, bytes, { retain: false }); assert.equal(received, 1);
    const inFlight = relay.send({ ...state, seq: 5 });
    client.connected = false; handlers.get('close')(); await inFlight;
    assert.equal(lost, 1); assert.equal(publishes.length, 2);
    await relay.send({ ...state, seq: 6 }); assert.equal(publishes.length, 2);
    client.connected = true; handlers.get('connect')(); subscribed.callback(null, [{ qos: 0 }]);
    assert.equal(ready, 2); assert.equal(publishes.length, 2);
    const pending = relay.send({ ...state, seq: 7 }); relay.close(); await pending;
    assert.equal(closed, true); assert.equal(publishes.length, 2);
  } finally { relay?.close(); globalThis.window = previous; }
});
