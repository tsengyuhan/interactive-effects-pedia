const sessionOwners = new WeakMap();

export function createSprayAudio({
  Audio = globalThis.AudioContext || globalThis.webkitAudioContext,
  navigator = globalThis.navigator,
  canPlay,
  onStatus = () => {},
}) {
  let context, source, gain, audioSession, previousType;
  let attempt = 0;
  let muted = false, disposed = false, level = 0;
  const owner = {};

  function report(status) { if (!disposed) onStatus(muted ? 'muted' : status); }
  function sync() {
    const next = !disposed && !muted && context?.state === 'running' && canPlay() ? .14 : 0;
    if (gain && next !== level) {
      gain.gain.cancelScheduledValues(context.currentTime);
      // 停止直接歸零，避免背景或失聯後仍有淡出尾音。
      gain.gain.setValueAtTime(next, context.currentTime);
    }
    level = next;
  }
  function sessionPlayback() {
    try {
      const current = navigator?.audioSession;
      if (!current || !('type' in current)) return;
      if (!audioSession) {
        audioSession = current; previousType = current.type;
        sessionOwners.set(current, owner);
      }
      if (sessionOwners.get(current) === owner) current.type = 'playback';
    } catch { /* 部分瀏覽器提供屬性但不允許寫入。 */ }
  }
  function prepare() {
    if (disposed || muted) return Promise.resolve();
    try {
      sessionPlayback();
      if (!context) {
        if (!Audio) { report('unavailable'); return Promise.resolve(); }
        context = new Audio();
        gain = context.createGain(); gain.gain.value = 0;
        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
        const filter = context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1100;
        source.connect(filter); filter.connect(gain); gain.connect(context.destination); source.start();
        context.onstatechange = () => {
          if (disposed) return;
          sync(); report(context.state === 'running' ? 'ready' : 'retry');
        };
      }
      // resume 必須在手勢的同步階段呼叫，完成時再讀取最新的噴漆條件。
      // 先前請求可能停在背景，新的手勢仍須能重試。
      const currentAttempt = ++attempt;
      const resumed = context.resume();
      return Promise.resolve(resumed).then(() => {
        sync();
        if (currentAttempt === attempt) report(context.state === 'running' ? 'ready' : 'retry');
      }, () => { sync(); if (currentAttempt === attempt) report('retry'); });
    } catch { sync(); report('retry'); return Promise.resolve(); }
  }
  function setMuted(value) {
    muted = value; sync(); report(value ? 'muted' : 'retry');
    if (!muted) return prepare();
    return Promise.resolve();
  }
  function suspend() {
    sync();
    try { Promise.resolve(context?.suspend()).catch(() => {}); } catch { /* 停噴已由增益歸零保證。 */ }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; sync();
    if (context) context.onstatechange = null;
    try { source?.stop(); } catch { /* 已停止的音源不需再次處理。 */ }
    try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* 關閉失敗仍維持靜音。 */ }
    try {
      if (audioSession && navigator?.audioSession === audioSession && sessionOwners.get(audioSession) === owner) {
        if (audioSession.type === 'playback') audioSession.type = previousType;
        sessionOwners.delete(audioSession);
      }
    } catch { /* 不干預已被其他使用者或瀏覽器更動的音訊工作階段。 */ }
  }
  return { prepare, sync, setMuted, suspend, dispose };
}
