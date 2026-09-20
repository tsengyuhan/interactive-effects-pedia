import { HostState, randomId, importKey, clamp } from './core.mjs';
import { connectRelay } from './relay.mjs';
import { createWall } from './wall.mjs';

export function createHost(root) {
  const t = window.t;
  const wall = createWall(root);
  const overlay = document.createElement('div');
  overlay.innerHTML = `<div class="wall-vignette"></div><header class="wall-heading"><div class="eyebrow">INTERACTIA / OPEN WALL PROJECT</div>
    <h1>${t('來噴漆吧')}</h1><p>${t('把手機變成噴漆罐，讓每一道轉向留下色彩。')}</p><div class="edition">NO. 024 — LEAVE A LITTLE COLOUR</div></header>
    <div class="aim-marker calibrating"></div><aside class="pair-panel"><h2>${t('你的手機，就是畫筆')}</h2>
      <p class="spray-status" role="status"></p><div class="qr-box"></div><p class="deployment-note" hidden></p><p class="pair-note"></p>
      <button class="copy-link">${t('複製手機連結')}</button><input class="link-field" readonly hidden aria-label="${t('手機配對連結')}">
      <details><summary>${t('連線說明與本機測試')}</summary><p>${t('兩台裝置都需連網。公開測試中繼不保證可用性，請勿分享配對連結。')}</p>
      <button class="local-link">${t('複製本機雙頁測試連結')}</button><button class="retry-relay">${t('重新連線')}</button></details>
    </aside><div class="wall-tools"><input type="color" value="#ef4939" aria-label="${t('滑鼠試噴顏色')}"><button class="clear-wall">${t('清牆')}</button><span>${t('按住滑鼠，也能試噴')}</span></div>`;
  root.append(overlay);
  const $ = s => root.querySelector(s);
  const status = $('.spray-status'), note = $('.pair-note'), qr = $('.qr-box'), marker = $('.aim-marker');
  const events = new AbortController(), options = { signal: events.signal };
  let host = null, room, secret, session, seq = 0, relay = null, ready = false, disposed = false, connecting = false;
  let shownURL = '', localURL = '', lastPulse = 0, raf = 0, previous = performance.now();
  let localPointer = null, localPoint = { x: .5, y: .5 }, localColor = '#ef4939';
  const smoothPoint = { x: .5, y: .5 };
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]';
  status.textContent = t('正在連線至公開中繼…');
  note.textContent = t('掃描 QR，啟用方向感測，再朝向中央十字確認對位。');
  function reset() {
    if (host) host.reset(randomId());
    smoothPoint.x = smoothPoint.y = .5;
    localPointer = null; marker.classList.add('calibrating');
  }
  function lost() {
    ready = false; reset(); status.classList.remove('connected');
    status.textContent = t('連線中斷，正在重新配對…');
  }
  function pulse(now) {
    if (!ready || document.hidden || !host) return;
    const beat = randomId(); host.issue(beat, now);
    relay.send({ v: 1, type: 'pulse', session, nonce: host.nonce, seq: ++seq, beat, target: host.session });
    lastPulse = now;
  }
  function receive(p) {
    if (document.hidden || !host.accept(p, performance.now())) return;
    status.classList.add('connected'); status.textContent = t('手機已連線');
    if (p.type === 'hello') pulse(performance.now());
  }
  function makeQR(url) {
    qr.replaceChildren();
    if (!window.qrcode) { note.textContent = t('QR 程式庫尚未就緒，請先使用複製連結。'); return; }
    try {
      const code = window.qrcode(0, 'M'); code.addData(url); code.make();
      qr.innerHTML = code.createSvgTag({ scalable: true });
      qr.querySelector('svg')?.setAttribute('aria-label', t('手機配對 QR'));
    } catch { note.textContent = t('QR 產生失敗，請使用複製連結。'); }
  }
  function pairingLinks() {
    const local = new URL(location.href); local.search = '?controller=1'; local.hash = new URLSearchParams({ room, key: secret }).toString();
    localURL = local.href;
    if (isLocal || location.protocol !== 'https:') {
      const deployed = new URL('https://tsengyuhan.github.io/interactive-effects-pedia/effects/spray-paint/');
      deployed.search = local.search; deployed.hash = local.hash; shownURL = deployed.href;
      const warning = $('.deployment-note'); warning.hidden = false;
      warning.textContent = t('本機網址無法供手機使用。此 QR 指向正式站，需先部署本效果與程式庫。');
    } else shownURL = localURL;
    makeQR(shownURL);
  }
  async function copy(url) {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); note.textContent = t('連結已複製，請只交給你的控制手機。'); }
    catch { const field = $('.link-field'); field.hidden = false; field.value = url; field.select(); note.textContent = t('請手動複製下方連結。'); }
  }
  async function connect() {
    if (connecting || disposed) return;
    if (!window.isSecureContext || !crypto.subtle) { status.textContent = t('需要 HTTPS 安全連線；本機測試請使用 localhost。'); return; }
    if (!window.mqtt) { status.textContent = t('缺少本地 MQTT 程式庫，請確認部署檔案完整後重新整理。'); return; }
    connecting = true; relay?.close(); ready = false;
    try {
      if (!room) {
        room = randomId(); secret = randomId(32); session = randomId(); host = new HostState(randomId()); pairingLinks();
      }
      reset();
      const key = await importKey(secret);
      if (disposed) return;
      relay = connectRelay({ room, key, controller: false, onPacket: receive,
        onReady() { reset(); ready = true; status.textContent = t('等待手機配對'); pulse(performance.now()); }, onLost: lost });
    } catch { status.textContent = t('無法啟動加密連線，請重新整理後重試。'); }
    finally { connecting = false; }
  }
  $('.copy-link').addEventListener('click', () => copy(shownURL), options);
  $('.local-link').addEventListener('click', () => copy(localURL), options);
  $('.retry-relay').addEventListener('click', connect, options);
  $('.clear-wall').addEventListener('click', () => wall.clear(), options);
  $('.wall-tools input').addEventListener('input', event => { localColor = event.target.value; }, options);
  function position(event) {
    const rect = wall.canvas.getBoundingClientRect();
    localPoint = { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
  wall.canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || localPointer !== null) return;
    localPointer = event.pointerId; wall.canvas.setPointerCapture(localPointer); position(event);
  }, options);
  wall.canvas.addEventListener('pointermove', event => { if (event.pointerId === localPointer) position(event); }, options);
  const stopLocal = () => { localPointer = null; };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) wall.canvas.addEventListener(name, stopLocal, options);
  window.addEventListener('blur', () => { reset(); }, options);
  document.addEventListener('visibilitychange', reset, options);
  function draw(now) {
    if (host?.tick(now)) { reset(); status.classList.remove('connected'); status.textContent = t('手機已離線，等待重新配對'); }
    if (now - lastPulse >= 250) pulse(now);
    const local = localPointer !== null;
    const dt = now - previous;
    if (!host?.calibrated) smoothPoint.x = smoothPoint.y = .5;
    else {
      // 中繼可能一次送達多筆位置，短暫平滑可減少紅點跳動與筆畫結珠。
      const blend = 1 - Math.exp(-Math.min(dt, 80) / 45);
      smoothPoint.x += (host.x - smoothPoint.x) * blend;
      smoothPoint.y += (host.y - smoothPoint.y) * blend;
    }
    const point = local ? localPoint : smoothPoint;
    marker.style.left = `${point.x * 100}%`; marker.style.top = `${point.y * 100}%`;
    marker.classList.toggle('calibrating', !local && !host?.calibrated);
    wall.render(point, local ? localColor : host?.color || '#ef4939', !document.hidden && (local || !!host?.pressed), dt);
    previous = now; raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw); connect();
  return () => { disposed = true; ready = false; events.abort(); cancelAnimationFrame(raf); relay?.close(); wall.dispose(); };
}
