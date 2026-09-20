export const SENSOR_TTL = 650;
export const PAINT_TTL = 950;
export const LINK_TTL = 3200;
export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const rad = Math.PI / 180;
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

// 直接組合 Z-X-Y 旋轉的基底，避開直立時 Euler 角拆解的奇異點。
export function orientationFrame({ alpha, beta, gamma }) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  if (alpha < 0 || alpha > 360 || Math.abs(beta) > 180 || Math.abs(gamma) > 90) return null;
  const [a, b, g] = [alpha, beta, gamma].map(v => v * rad);
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  return {
    right: [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg],
    up: [-sa * cb, ca * cb, sb],
    forward: [-ca * sg - sa * sb * cg, -sa * sg + ca * sb * cg, -cb * cg]
  };
}

export function aimFromFrames(origin, current, sensitivity = 1) {
  if (!origin || !current || !Number.isFinite(sensitivity)) return null;
  const f = current.forward;
  const forward = dot(f, origin.forward);
  const yaw = Math.atan2(dot(f, origin.right), forward);
  const pitch = Math.atan2(dot(f, origin.up), Math.hypot(forward, dot(f, origin.right)));
  return { x: clamp(.5 + yaw / (Math.PI / 2) * sensitivity), y: clamp(.5 - pitch / (Math.PI / 2) * sensitivity) };
}

const id = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
export function validPacket(p) {
  if (!p || typeof p !== 'object' || p.v !== 1 || !id(p.session) || !id(p.nonce) || !Number.isSafeInteger(p.seq) || p.seq < 1) return false;
  if (p.type === 'hello') return true;
  if (p.type === 'pulse') return id(p.beat) && (p.target === null || id(p.target));
  if (p.type === 'state') return id(p.beat) && typeof p.pressed === 'boolean' && typeof p.calibrated === 'boolean'
    && [p.x, p.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)
    && typeof p.color === 'string' && /^#[a-fA-F0-9]{6}$/.test(p.color);
  return false;
}

export class HostState {
  constructor(nonce) { this.reset(nonce); }
  reset(nonce) {
    this.nonce = nonce;
    this.session = null;
    this.seq = 0;
    this.lastSeen = -Infinity;
    this.pressed = false;
    this.calibrated = false;
    this.x = this.y = .5;
    this.color = '#ef4939';
    this.beats = new Map();
  }
  issue(beat, now) {
    this.beats.set(beat, now);
    for (const [key, time] of this.beats) if (now - time > PAINT_TTL) this.beats.delete(key);
  }
  accept(p, now, retained = false) {
    if (retained || !validPacket(p) || p.nonce !== this.nonce || p.type === 'pulse') return false;
    if (p.type === 'hello') {
      if (this.session) return false;
      this.session = p.session;
      this.seq = p.seq;
      this.lastSeen = now;
      this.pressed = false;
      return true;
    }
    const issued = this.beats.get(p.beat);
    if (p.session !== this.session || p.seq <= this.seq || issued === undefined || now - issued > PAINT_TTL) return false;
    this.seq = p.seq;
    this.lastSeen = now;
    this.pressed = p.pressed && p.calibrated;
    this.calibrated = p.calibrated;
    this.x = p.x;
    this.y = p.y;
    this.color = p.color;
    return true;
  }
  tick(now) {
    if (now - this.lastSeen > PAINT_TTL) { this.pressed = false; this.calibrated = false; }
    return !!this.session && now - this.lastSeen > LINK_TTL;
  }
}

export function canSpray({ paired, calibrated, held, visible, sensorAt, pulseAt }, now) {
  return !!(paired && calibrated && held && visible && now - sensorAt <= SENSOR_TTL && now - pulseAt <= PAINT_TTL);
}

export function randomId(bytes = 16) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

export function parsePairing(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const room = params.get('room'), key = params.get('key');
  return id(room) && /^[a-f0-9]{64}$/.test(key || '') ? { room, key } : null;
}

export async function importKey(hex) {
  return crypto.subtle.importKey('raw', Uint8Array.from(hex.match(/../g), v => parseInt(v, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptPacket(key, packet) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(packet));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const result = new Uint8Array(12 + cipher.length);
  result.set(iv); result.set(cipher, 12);
  return result;
}

export async function decryptPacket(key, bytes) {
  if (!bytes || bytes.byteLength < 29 || bytes.byteLength > 4096) return null;
  try {
    const raw = new Uint8Array(bytes);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    const packet = JSON.parse(new TextDecoder().decode(plain));
    return validPacket(packet) ? packet : null;
  } catch { return null; }
}
