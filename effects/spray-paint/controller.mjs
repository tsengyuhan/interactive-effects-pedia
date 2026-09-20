import { orientationFrame, aimFromFrames, canSpray, randomId, parsePairing, importKey, SENSOR_TTL, PAINT_TTL } from './core.mjs';
import { connectRelay } from './relay.mjs';
import { createSprayAudio } from './audio.mjs';

export function createController(root) {
  const t = window.t;
  root.classList.add('controller');
  document.body.classList.add('spray-controller');
  root.innerHTML = `<div class="controller-inner">
    <h1>${t('掌心裡的噴漆罐')}</h1>
    <p class="spray-status" role="status"></p><p class="sensor-note" role="status"></p>
    <div class="setup-buttons"><button class="enable-sensor">${t('啟用方向感測')}</button><button class="calibrate" disabled>${t('確認對位')}</button></div>
    <div class="can-stage"><div class="can-shadow"></div><div class="spray-can"><div class="can-label"><strong>MAKE<br>YOUR<br>MARK.</strong><small>400 ML / AIR CONTROL</small></div></div><div class="mist"></div>
      <div class="nozzle-track"><button class="nozzle" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${t('下拉噴頭並按住')}" disabled></button></div>
    </div><p class="spray-caption">${t('下拉噴頭並按住，放開即停噴')}</p>
    <div class="palette"></div>
    <div class="controller-tools"><button class="audio-toggle" aria-pressed="true">${t('音效開')}</button><button class="fullscreen-toggle">${t('開啟全螢幕')}</button>
    <details class="controller-settings"><summary>${t('設定')}</summary><div class="settings-content"><label class="sensitivity">${t('轉向靈敏度')}<input type="range" min="0.5" max="2" step="0.1" value="1"></label>
    <p class="controller-footnote">${t('直立握住手機，左右轉向、上下抬低。不是平移追蹤。')}<br>${t('不使用相機或麥克風')}</p></div></details></div>
    <div class="audio-note" role="status" hidden><span></span> <button class="audio-retry">${t('重試音效')}</button></div><p class="fullscreen-note" role="status" hidden></p>
    <p class="portrait-note" role="alert" hidden>${t('請將手機轉回直向')}</p>
  </div>`;
  const $ = s => root.querySelector(s);
  const status = $('.spray-status'), note = $('.sensor-note'), nozzle = $('.nozzle'), stage = $('.can-stage');
  const enable = $('.enable-sensor'), calibrate = $('.calibrate');
  const events = new AbortController(), options = { signal: events.signal };
  const state = { paired: false, calibrated: false, held: false, visible: !document.hidden, sensorAt: -Infinity, pulseAt: -Infinity };
  let relay, session, nonce = null, hostSession = null, beat = null, seq = 0, hostSeq = 0;
  let frame = null, origin = null, aim = { x: .5, y: .5 }, color = '#ef4939', sensitivity = 1;
  let permission = false, waitingAt = 0, pointer = null, startY = 0;
  let disposed = false, connecting = false;
  const portrait = window.matchMedia('(orientation: portrait)');
  let isPortrait = portrait.matches, muted = false;
  const audioButton = $('.audio-toggle'), audioNote = $('.audio-note');
  const audio = createSprayAudio({ canPlay: () => !disposed && isPortrait && canSpray(state, performance.now()), onStatus(value) {
    audioButton.textContent = t(value === 'muted' ? '音效關' : '音效開');
    audioButton.setAttribute('aria-pressed', String(!muted));
    audioNote.hidden = !['retry', 'unavailable'].includes(value);
    audioNote.querySelector('span').textContent = value === 'unavailable' ? t('此瀏覽器無法播放音效，可繼續噴漆。') : t('音效已暫停，點「重試音效」恢復。');
    $('.audio-retry').hidden = value !== 'retry';
  } });
  audioButton.addEventListener('click', () => {
    muted = !muted; audio.setMuted(muted);
  }, options);
  $('.audio-retry').addEventListener('click', () => audio.prepare(), options);
  status.textContent = t('正在連線至公開中繼…');
  note.textContent = t('先啟用感測，再朝向電腦中央十字確認對位。');

  function sound(on) {
    audio.sync();
    stage.classList.toggle('is-spraying', on);
  }
  function send() {
    const pressed = isPortrait && canSpray(state, performance.now());
    sound(pressed);
    if (!relay || !state.paired || !nonce || !beat || disposed) return;
    relay.send({ v: 1, type: 'state', session, nonce, seq: ++seq, beat, x: aim.x, y: aim.y, color, pressed, calibrated: state.calibrated });
  }
  function stop() {
    state.held = false;
    const captured = pointer; pointer = null;
    if (captured !== null && nozzle.hasPointerCapture(captured)) nozzle.releasePointerCapture(captured);
    nozzle.style.transform = ''; nozzle.setAttribute('aria-valuenow', '0');
    stage.classList.remove('is-held'); sound(false); send();
  }
  function uncalibrate(message) {
    root.classList.remove('is-calibrated');
    note.hidden = false;
    state.calibrated = false; origin = null; aim = { x: .5, y: .5 };
    calibrate.textContent = t('確認對位'); nozzle.disabled = true;
    stop();
    if (message) note.textContent = t(message);
  }
  function disconnected() {
    state.paired = false; nonce = null; hostSession = null; beat = null; hostSeq = 0;
    status.classList.remove('connected'); status.textContent = t('連線中斷，正在重新配對…');
    uncalibrate('連線恢復後，請重新確認對位。'); calibrate.disabled = true;
  }
  function receive(p) {
    if (p.type !== 'pulse' || !state.visible) return;
    if (state.paired && performance.now() - state.pulseAt > PAINT_TTL) disconnected();
    if (p.session !== hostSession || p.nonce !== nonce) {
      uncalibrate('請將手機朝向電腦中央十字，再按確認對位。');
      state.paired = false; hostSession = p.session; nonce = p.nonce; hostSeq = 0;
    }
    if (p.seq <= hostSeq) return;
    hostSeq = p.seq; beat = p.beat; state.pulseAt = performance.now();
    if (p.target === null) {
      state.paired = false;
      uncalibrate('請將手機朝向電腦中央十字，再按確認對位。');
      relay.send({ v: 1, type: 'hello', session, nonce, seq: ++seq });
      status.textContent = t('正在配對…');
    } else if (p.target === session) {
      state.paired = true; status.classList.add('connected'); status.textContent = t('已連線 · 朝向牆面開始創作');
    } else {
      state.paired = false; uncalibrate('已有另一台手機連線，請等候它離線。');
      status.textContent = t('控制器使用中'); status.classList.remove('connected');
    }
  }
  async function connect() {
    if (connecting || disposed) return;
    const pairing = parsePairing(location.hash);
    if (!pairing) { status.textContent = t('配對連結無效，請重新掃描電腦上的 QR。'); return; }
    if (!window.isSecureContext || !crypto.subtle) { status.textContent = t('需要 HTTPS 安全連線；本機測試請使用 localhost。'); return; }
    if (!window.mqtt) { status.textContent = t('缺少本地 MQTT 程式庫，請確認部署檔案完整後重新整理。'); return; }
    connecting = true;
    try {
      const key = await importKey(pairing.key);
      if (disposed) return;
      relay = connectRelay({ ...pairing, key, controller: true, onPacket: receive,
        onReady() { disconnected(); session = randomId(); seq = 0; status.textContent = t('等待電腦回應…'); }, onLost: disconnected });
    } catch { status.textContent = t('無法啟動加密連線，請重新整理後重試。'); }
    finally { connecting = false; }
  }

  async function enableSensor() {
    uncalibrate(); permission = false; enable.disabled = true;
    audio.prepare();
    if (!window.isSecureContext) { note.textContent = t('手機感測需要 HTTPS，請從已部署的線上網址開啟。'); enable.disabled = false; return; }
    const Sensor = window.DeviceOrientationEvent;
    if (!Sensor) { note.textContent = t('此裝置沒有方向感測支援，請改用有感測器的手機。'); enable.disabled = false; return; }
    try {
      // iOS 必須在按鈕的使用者手勢內立即要求權限。
      if (typeof Sensor.requestPermission === 'function' && await Sensor.requestPermission() !== 'granted') {
        note.textContent = t('方向感測權限被拒絕。請在瀏覽器設定允許後按重試。'); return;
      }
      if (disposed) return;
      permission = true; waitingAt = performance.now(); state.sensorAt = -Infinity; frame = null;
      note.textContent = t('等待方向感測資料，請輕輕轉動手機…');
    } catch { note.textContent = t('方向感測權限被拒絕。請在瀏覽器設定允許後按重試。'); }
    finally { enable.disabled = false; enable.textContent = t('重試感測'); }
  }
  enable.addEventListener('click', enableSensor, options);
  window.addEventListener('deviceorientation', event => {
    if (!permission || !state.visible) return;
    if (state.calibrated && performance.now() - state.sensorAt > SENSOR_TTL)
      uncalibrate('方向感測已逾時，請重試並重新確認對位。');
    const next = orientationFrame(event);
    if (!next) { frame = null; uncalibrate('方向資料無效，請重試感測。'); return; }
    const first = !frame;
    frame = next; state.sensorAt = performance.now(); waitingAt = 0;
    if (origin) aim = aimFromFrames(origin, frame, sensitivity);
    else if (first) note.textContent = t('請將手機朝向電腦中央十字，再按確認對位。');
  }, options);
  calibrate.addEventListener('click', () => {
    audio.prepare();
    if (!isPortrait || !frame || !state.paired || performance.now() - state.sensorAt > SENSOR_TTL) return;
    stop(); origin = frame; aim = { x: .5, y: .5 }; state.calibrated = true;
    calibrate.textContent = t('重新置中'); nozzle.disabled = false;
    root.classList.add('is-calibrated'); note.hidden = true;
    note.textContent = t('已對位。下拉噴頭，轉動手機畫出你的線條。'); send();
  }, options);
  const changedDirection = () => {
    isPortrait = portrait.matches;
    $('.portrait-note').hidden = isPortrait;
    root.classList.toggle('is-landscape', !isPortrait);
    uncalibrate(isPortrait ? '螢幕方向已改變，請重新確認對位。' : '請將手機轉回直向');
    calibrate.disabled = true;
  };
  portrait.addEventListener('change', changedDirection, options);
  window.addEventListener('orientationchange', changedDirection, options);
  screen.orientation?.addEventListener('change', changedDirection, options);
  if (!isPortrait) changedDirection();
  nozzle.addEventListener('pointerdown', event => {
    if (!isPortrait || !state.calibrated || !state.paired || pointer !== null || event.button !== 0) return;
    event.preventDefault(); audio.prepare(); pointer = event.pointerId; startY = event.clientY;
    nozzle.setPointerCapture(pointer); stage.classList.add('is-held');
  }, options);
  nozzle.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const pull = Math.min(34, Math.max(0, event.clientY - startY));
    nozzle.style.transform = `translateY(${pull}px)`; nozzle.setAttribute('aria-valuenow', String(Math.round(pull / 34 * 100)));
    state.held = pull > 8; send();
  }, options);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) nozzle.addEventListener(name, stop, options);
  nozzle.addEventListener('keydown', event => {
    if (![' ', 'ArrowDown'].includes(event.key) || event.repeat || nozzle.disabled) return;
    event.preventDefault(); audio.prepare(); state.held = true; nozzle.style.transform = 'translateY(34px)';
    nozzle.setAttribute('aria-valuenow', '100'); send();
  }, options);
  nozzle.addEventListener('keyup', event => { if ([' ', 'ArrowDown'].includes(event.key)) stop(); }, options);
  nozzle.addEventListener('blur', stop, options);
  window.addEventListener('blur', () => uncalibrate('操作已暫停，請重新確認對位。'), options);
  document.addEventListener('visibilitychange', () => {
    state.visible = !document.hidden;
    uncalibrate('操作已暫停，請重新確認對位。');
    if (document.hidden) { state.paired = false; audio.suspend(); }
  }, options);
  const palette = $('.palette');
  const colors = ['#ef4939', '#eed95b', '#76c8bd', '#748fe4', '#f4efdd'];
  function setColor(value) {
    color = value; root.style.setProperty('--spray-color', value);
    for (const b of palette.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.color === value));
    picker.value = value; send();
  }
  for (const value of colors) {
    const b = document.createElement('button'); b.className = 'swatch'; b.dataset.color = value;
    b.style.setProperty('--swatch', value); b.setAttribute('aria-label', `${t('噴漆顏色')} ${value}`);
    b.addEventListener('click', () => setColor(value), options); palette.append(b);
  }
  const picker = document.createElement('input'); picker.type = 'color'; picker.setAttribute('aria-label', t('自訂噴漆顏色'));
  picker.addEventListener('input', () => setColor(picker.value), options); palette.append(picker); setColor(color);
  $('.sensitivity input').addEventListener('input', event => { sensitivity = Number(event.target.value); if (origin && frame) aim = aimFromFrames(origin, frame, sensitivity); }, options);

  const fullscreenButton = $('.fullscreen-toggle'), fullscreenNote = $('.fullscreen-note');
  let lockedPortrait = false, fullscreenPending = false;
  function unlockPortrait() {
    if (!lockedPortrait) return;
    lockedPortrait = false;
    try { screen.orientation?.unlock?.(); } catch { /* 只釋放本效果取得的鎖定。 */ }
  }
  function fullscreenFallback() {
    if (disposed) return;
    fullscreenNote.hidden = false;
    fullscreenNote.textContent = t('若無法全螢幕或鎖定直向，請使用手機系統的直向鎖定。');
  }
  document.addEventListener('fullscreenchange', () => {
    fullscreenButton.textContent = t(document.fullscreenElement ? '退出全螢幕' : '開啟全螢幕');
    if (!document.fullscreenElement) unlockPortrait();
  }, options);
  fullscreenButton.addEventListener('click', async () => {
    if (fullscreenPending || disposed) return;
    fullscreenPending = true; fullscreenButton.disabled = true;
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      if (!document.documentElement.requestFullscreen) { fullscreenFallback(); return; }
      await document.documentElement.requestFullscreen();
      if (disposed || document.fullscreenElement !== document.documentElement) return;
      if (!screen.orientation?.lock) { fullscreenFallback(); return; }
      await screen.orientation.lock('portrait');
      lockedPortrait = true;
      if (disposed || document.fullscreenElement !== document.documentElement) unlockPortrait();
      else fullscreenNote.hidden = true;
    } catch { fullscreenFallback(); }
    finally { fullscreenPending = false; fullscreenButton.disabled = false; }
  }, options);

  const timer = setInterval(() => {
    const now = performance.now();
    if (state.paired && now - state.pulseAt > PAINT_TTL) disconnected();
    if (state.calibrated && now - state.sensorAt > SENSOR_TTL) uncalibrate('方向感測已逾時，請重試並重新確認對位。');
    if (waitingAt && now - waitingAt > 4500) { waitingAt = 0; note.textContent = t('未收到方向資料。請確認感測權限，或換一台手機後重試。'); }
    calibrate.disabled = !isPortrait || !state.paired || !frame || now - state.sensorAt > SENSOR_TTL;
    send();
  }, 40);
  connect();
  return () => {
    stop(); disposed = true; clearInterval(timer); events.abort(); relay?.close();
    audio.dispose(); unlockPortrait(); document.body.classList.remove('spray-controller');
  };
}
