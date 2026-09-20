import { clamp } from './core.mjs';

export function createWall(root) {
  const canvas = document.createElement('canvas');
  canvas.className = 'paint-wall';
  canvas.setAttribute('aria-label', window.t('水泥塗鴉牆'));
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  const paint = document.createElement('canvas'), ink = paint.getContext('2d');
  const texture = document.createElement('canvas'), stone = texture.getContext('2d');
  let w = 0, h = 0, ratio = 1, last = null, drips = [], sprayColor = '';
  const brush = document.createElement('canvas');
  brush.width = brush.height = 96;
  const brushCtx = brush.getContext('2d');

  function makeBrush(color) {
    if (color === sprayColor) return;
    sprayColor = color;
    brushCtx.clearRect(0, 0, 96, 96);
    const soft = brushCtx.createRadialGradient(48, 48, 0, 48, 48, 48);
    soft.addColorStop(0, color + '70'); soft.addColorStop(.4, color + '35'); soft.addColorStop(1, color + '00');
    brushCtx.fillStyle = soft; brushCtx.fillRect(0, 0, 96, 96);
    for (let i = 0; i < 650; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 46;
      brushCtx.globalAlpha = (1 - r / 48) * .45;
      brushCtx.fillStyle = color;
      brushCtx.fillRect(48 + Math.cos(a) * r, 48 + Math.sin(a) * r, .5 + Math.random(), .5 + Math.random());
    }
    brushCtx.globalAlpha = 1;
  }

  function makeTexture() {
    stone.fillStyle = '#b4b1a5'; stone.fillRect(0, 0, w, h);
    const light = stone.createLinearGradient(0, 0, w, h);
    light.addColorStop(0, '#d4d0bd'); light.addColorStop(.5, '#a6a697'); light.addColorStop(1, '#656e6b');
    stone.fillStyle = light; stone.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 22; i++) {
      stone.fillStyle = Math.random() < .5 ? '#252b2520' : '#fffde524';
      const s = Math.random() * 2.4 + .4;
      stone.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    // 不規則剝落與細裂縫讓牆面保留可見的材質。
    for (let i = 0; i < 32; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 8 + Math.random() * 60;
      stone.beginPath();
      for (let n = 0; n < 16; n++) {
        const a = n / 16 * Math.PI * 2, reach = r * (.35 + Math.random() * .65);
        stone.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach * .45);
      }
      stone.closePath(); stone.fillStyle = '#e3decb22'; stone.fill();
      stone.strokeStyle = '#41494025'; stone.lineWidth = 1; stone.stroke();
    }
    for (let i = 0; i < 9; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      stone.beginPath(); stone.moveTo(x, y);
      for (let j = 0; j < 12; j++) { x += Math.random() * 32 - 16; y += Math.random() * 19; stone.lineTo(x, y); }
      stone.strokeStyle = '#26312944'; stone.lineWidth = .6; stone.stroke();
    }
    for (let y = 220; y < h; y += 245) {
      stone.fillStyle = '#202f2a20'; stone.fillRect(0, y, w, 2);
      stone.fillStyle = '#f4edda20'; stone.fillRect(0, y + 2, w, 1);
    }
  }

  function resize() {
    const old = document.createElement('canvas'); old.width = paint.width; old.height = paint.height;
    if (old.width) old.getContext('2d').drawImage(paint, 0, 0);
    w = root.clientWidth; h = root.clientHeight; ratio = Math.min(devicePixelRatio || 1, 2);
    for (const c of [canvas, paint, texture]) { c.width = Math.round(w * ratio); c.height = Math.round(h * ratio); }
    for (const c of [ctx, ink, stone]) c.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (old.width) ink.drawImage(old, 0, 0, w, h);
    last = null; drips = []; makeTexture();
  }
  resize();
  const observer = new ResizeObserver(resize); observer.observe(root);

  return {
    canvas,
    render(point, color, spraying, dt) {
      dt = clamp(dt, 0, 40);
      if (spraying) {
        makeBrush(color);
        const next = { x: point.x * w, y: point.y * h };
        const from = last || next, distance = Math.hypot(next.x - from.x, next.y - from.y);
        const steps = Math.max(1, Math.ceil(distance / 3));
        ink.globalAlpha = clamp(dt / 16, .2, 1);
        for (let i = 1; i <= steps; i++) {
          const x = from.x + (next.x - from.x) * i / steps, y = from.y + (next.y - from.y) * i / steps;
          ink.drawImage(brush, x - 23, y - 23, 46, 46);
        }
        ink.globalAlpha = 1;
        if (distance < 2 && Math.random() < dt / 650 && drips.length < 80)
          drips.push({ x: next.x + Math.random() * 16 - 8, y: next.y, left: 12 + Math.random() * 45, color, width: 1 + Math.random() });
        last = next;
      } else last = null;
      for (const drip of drips) {
        const step = Math.min(drip.left, dt * .015);
        ink.strokeStyle = drip.color + '55'; ink.lineWidth = drip.width;
        ink.beginPath(); ink.moveTo(drip.x, drip.y); ink.lineTo(drip.x, drip.y + step); ink.stroke();
        drip.y += step; drip.left -= step;
      }
      drips = drips.filter(d => d.left > 0);
      ctx.drawImage(texture, 0, 0, w, h); ctx.drawImage(paint, 0, 0, w, h);
    },
    clear() { ink.clearRect(0, 0, w, h); drips = []; last = null; },
    dispose() { observer.disconnect(); }
  };
}
