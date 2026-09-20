import { encryptPacket, decryptPacket, randomId } from './core.mjs';

export function connectRelay({ room, key, controller, onReady, onLost, onPacket }) {
  const prefix = `interactia/spray/v1/${room}/`;
  const incoming = prefix + (controller ? 'host' : 'controller');
  const outgoing = prefix + (controller ? 'controller' : 'host');
  let ready = false, closed = false, epoch = 0, busy = false, revision = 0;
  const client = window.mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
    clientId: `spray-${randomId()}`, clean: true, queueQoSZero: false,
    reconnectPeriod: 2000, connectTimeout: 10000, keepalive: 10, resubscribe: false
  });
  const lost = () => {
    if (closed) return;
    ready = false; epoch++; busy = false; onLost();
  };
  client.on('connect', () => {
    if (closed) return;
    const connectedEpoch = ++epoch;
    client.subscribe(incoming, { qos: 0 }, (error, grants) => {
      if (closed || connectedEpoch !== epoch) return;
      if (error || !grants?.length || grants.some(g => g.qos === 128)) { lost(); return; }
      ready = true; onReady();
    });
  });
  client.on('message', async (topic, bytes, metadata) => {
    if (!ready || closed || topic !== incoming || metadata.retain || bytes.byteLength > 4096) return;
    const receivedEpoch = epoch;
    const packet = await decryptPacket(key, bytes);
    if (packet && ready && !closed && epoch === receivedEpoch) onPacket(packet);
  });
  client.on('close', lost);
  client.on('offline', lost);
  client.on('error', lost);
  return {
    async send(packet) {
      // 加密期間不堆積畫筆位置；網路切換後的舊工作也不能補送。
      const sentRevision = ++revision;
      if (!ready || !client.connected || closed || busy) return;
      busy = true;
      const sentEpoch = epoch, began = performance.now();
      try {
        const bytes = await encryptPacket(key, packet);
        if (ready && client.connected && !closed && sentEpoch === epoch && sentRevision === revision && performance.now() - began < 180)
          client.publish(outgoing, bytes, { qos: 0, retain: false });
      } catch { lost(); }
      finally { if (sentEpoch === epoch) busy = false; }
    },
    close() { closed = true; ready = false; epoch++; client.end(true); }
  };
}
