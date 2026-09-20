import { MAX_SCALE, resetState, pump, advance, estimateHead, splitMask, portraitBounds, fitPortrait, balloonPose, fractureBalloon, advanceShard, resetSwing, trackSwing, advanceSwing,neckColorFromPixels,ruptureProfile } from './physics.mjs';
import { createBalloon } from './balloon.mjs';

const shell = Shell.init({ id: 'exploding-head' });
const canvas = document.createElement('canvas');
canvas.className = 'exploding-stage';
canvas.setAttribute('aria-label', t('即時充氣人像'));
shell.container.append(canvas);
const ctx = canvas.getContext('2d');
const video = document.createElement('video');
video.muted = true;
video.autoplay = true;
video.playsInline = true;

function surface() {
  const canvas = document.createElement('canvas');
  return { canvas, ctx: canvas.getContext('2d') };
}
const frame = surface(), body = surface(), headLayer = surface();
const bodyMask = surface(), headMask = surface(), debris = surface();
const neckSample=surface(), neckLayer=surface(), neckMask=surface();
let neckReady=false,neckColor=null,rupture=null;
let bodyPixels, headPixels;
let state = resetState();
let background = '#dcebe3', speed = 1, maxScale=MAX_SCALE;
let swing=resetSwing();
let stream, segmenter, detector, audio;
let stopped = false, ready = false, tracked = false, head = null;
let raf = 0, lastTime = 0, lastVideoTime = -1, lastFrameAt = 0;
let width = 1, height = 1, dpr = 1, cameraTimer = 0, startupTimer = 0;
let particles = [], lastPose = null, statusKey = '';
let composition = null, cameraWidth = 0, cameraHeight = 0;
let balloon;

const controls = document.createElement('div');
controls.className = 'exploding-controls';
const status = document.createElement('p');
status.className = 'exploding-status';
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
const meter = document.createElement('div');
meter.className = 'exploding-meter';
const progress = document.createElement('progress');
progress.max = 1;
progress.value = 0;
progress.setAttribute('aria-label', t('充氣進度'));
const percent = document.createElement('span');
percent.textContent = '0%';
const button = document.createElement('button');
button.type = 'button';
button.className = 'exploding-pump';
button.textContent = t('打氣');
button.disabled = true;
meter.append(progress, percent);
controls.append(status, meter, button);
shell.container.append(controls);

function updateUI() {
  button.textContent=t(state.exploded?'重置':'打氣');
  button.disabled = stopped || document.hidden || (!state.exploded && (!ready || !tracked || state.pressure >= 1));
  progress.value = state.pressure;
  percent.textContent = `${Math.round(state.pressure * 100)}%`;
  const key = stopped ? '效果已停止，請重新整理。' : !ready ? '正在準備攝影機與本地模型…'
    : document.hidden ? '分頁暫停中'
    : !tracked ? (state.exploded ? '追蹤遺失，已暫停顯示人像；請重新正對鏡頭。' : '請一個人正對鏡頭，讓頭髮與肩膀完整入鏡。')
    : state.exploded ? '砰！移動看看無頭人像，按重置再玩一次。'
    : state.pressure >= 1 ? '快爆炸了…'
    : '連點打氣，讓整顆頭慢慢膨脹！';
  if (key !== statusKey) { status.textContent = t(key); statusKey = key; }
}

shell.addParam({ type: 'color', key: 'background', label: '背景顏色', value: background,
  onChange: value => { background = value; draw(performance.now()); } });
shell.addParam({ type: 'range', key: 'speed', label: '充氣速度', min: 0.5, max: 2, step: 0.25, value: speed,
  onChange: value => { speed = value; } });
shell.addParam({ type:'range',key:'maxScale',label:'氣球最大尺寸（倍）',min:1.5,max:4,step:.05,value:maxScale,
  onChange:value=>{
    maxScale=Number(value);
    const target=1+state.pressure*(maxScale-1);
    if(state.scale>target) { state.scale=target; state.velocity=Math.min(0,state.velocity); }
    composition=head?portraitBounds(frame.canvas.width,frame.canvas.height,head,maxScale):null;
  } });

function resetEffect() {
  if (stopped) return;
  state = resetState(); particles = []; lastPose = null; composition = null;
  swing=resetSwing();
  neckColor=null; neckReady=false; rupture=null;
  debris.canvas.width = debris.canvas.height = 1;
  updateUI();
}

function sound(explosion = false) {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || stopped) return;
    if (!audio) audio = new Audio();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    const now = audio.currentTime;
    const gain = audio.createGain();
    gain.connect(audio.destination);
    const oscillator = audio.createOscillator();
    oscillator.type = explosion ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(explosion ? 150 : 240 + state.pressure * 180, now);
    oscillator.frequency.exponentialRampToValueAtTime(explosion ? 28 : 600, now + (explosion ? 0.35 : 0.1));
    gain.gain.setValueAtTime(explosion ? 0.3 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (explosion ? 0.45 : 0.13));
    oscillator.connect(gain);
    oscillator.start(now); oscillator.stop(now + (explosion ? 0.5 : 0.15));
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    if (explosion) {
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.3), audio.sampleRate);
      const values = buffer.getChannelData(0);
      for (let i = 0; i < values.length; i++) values[i] = (Math.random() * 2 - 1) * (1 - i / values.length) ** 3 * 0.23;
      const noise = audio.createBufferSource();
      noise.buffer = buffer; noise.connect(audio.destination); noise.start();
      noise.onended = () => noise.disconnect();
    }
  } catch { /* 音訊不可用仍能完成視覺互動。 */ }
}

button.addEventListener('click', () => {
  if (button.disabled) return;
  if(state.exploded) { resetEffect(); return; }
  sound(); pump(state, speed); updateUI();
});

function resize() {
  width = shell.container.clientWidth || window.innerWidth;
  height = shell.container.clientHeight || window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  draw(performance.now());
}

function infer(now) {
  const w = Math.min(video.videoWidth, 640);
  const h = Math.round(video.videoHeight * w / video.videoWidth);
  if (w < 1 || h < 1) return;
  if (cameraWidth !== video.videoWidth || cameraHeight !== video.videoHeight) {
    composition = null; swing=resetSwing();
    cameraWidth = video.videoWidth; cameraHeight = video.videoHeight;
  }
  for (const layer of [frame, body, headLayer]) {
    if (layer.canvas.width !== w || layer.canvas.height !== h) {
      layer.canvas.width = w; layer.canvas.height = h;
    }
  }
  // 兩個模型與合成都讀同一份快照，避免推論間相機換幀造成重影。
  frame.ctx.drawImage(video, 0, 0, w, h);
  const detections = detector.detectForVideo(frame.canvas, now).detections;
  let result;
  try {
    result = segmenter.segmentForVideo(frame.canvas, now);
    const mask = result.confidenceMasks?.[0];
    if (!mask) throw new Error('Missing foreground mask');
    const data = mask.getAsFloat32Array();
    head = detections.length === 1 ? estimateHead(detections[0].boundingBox, data, mask.width, mask.height, w, h) : null;
    tracked = Boolean(head);
    if(head) trackSwing(swing,head.cx,now,w); else swing=resetSwing();
    if (head && !composition) composition = portraitBounds(w, h, head,maxScale);
    if (!bodyPixels || bodyPixels.width !== mask.width || bodyPixels.height !== mask.height) {
      for (const layer of [bodyMask, headMask]) { layer.canvas.width = mask.width; layer.canvas.height = mask.height; }
      bodyPixels = bodyMask.ctx.createImageData(mask.width, mask.height);
      headPixels = headMask.ctx.createImageData(mask.width, mask.height);
    }
    splitMask(data, mask.width, mask.height, w, h, head, bodyPixels.data, headPixels.data,rupture);
    bodyMask.ctx.putImageData(bodyPixels, 0, 0); headMask.ctx.putImageData(headPixels, 0, 0);
    for (const [layer, matte] of [[body, bodyMask], [headLayer, headMask]]) {
      layer.ctx.globalCompositeOperation = 'source-over';
      layer.ctx.clearRect(0, 0, w, h); layer.ctx.drawImage(frame.canvas, 0, 0);
      layer.ctx.globalCompositeOperation = 'destination-in';
      // 相同低解析遮罩分割兩部分，接縫不會留下原尺寸的頭。
      layer.ctx.drawImage(matte.canvas, 0, 0, w, h);
      layer.ctx.globalCompositeOperation = 'source-over';
    }
    if (head && !state.exploded) { balloon.update(headLayer.canvas, head); updateNeck(); }
    ready = true;
    lastFrameAt = now;
    clearTimeout(startupTimer);
    shell.hideLoading();
    updateUI();
  } finally { result?.close(); }
}

function layout() {
  const fw = frame.canvas.width, fh = frame.canvas.height;
  return fitPortrait(composition || portraitBounds(fw, fh, null), fw, width, height);
}

function headPose(now, view) {
  return balloonPose(head, state, now, view,swing);
}

function updateNeck() {
  if(neckSample.canvas.width!==64) {
    neckSample.canvas.width=neckSample.canvas.height=64;
    neckLayer.canvas.width=neckMask.canvas.width=128;
    neckLayer.canvas.height=neckMask.canvas.height=192;
    const mask=neckMask.ctx.createImageData(128,192);
    for(let y=0;y<192;y++) for(let x=0;x<128;x++) {
      const t=y/191,spread=Math.min(1,t/.4);
      // 氣口窄、接回原頸時漸擴，不能把整段脖子一併勒細。
      const radius=27+33*spread*spread*(3-2*spread);
      const side=Math.max(0,Math.min(1,(radius-Math.abs(x-63.5))/5));
      const vertical=Math.min(1,y/8,(191-y)/24);
      mask.data[(y*128+x)*4+3]=Math.round(255*side*side*(3-2*side)*vertical);
    }
    neckMask.ctx.putImageData(mask,0,0);
  }
  const length=head.bottom-head.top;
  neckSample.ctx.clearRect(0,0,64,64);
  // 優先取原下巴以下的脖子色；中位數不把鬍鬚、衣領或背景放大成貼片。
  neckSample.ctx.drawImage(body.canvas,head.cx-head.chinWidth*.40,head.bottom+length*.012,head.chinWidth*.8,length*.065,0,0,64,64);
  const current=neckColorFromPixels(neckSample.ctx.getImageData(0,0,64,64).data);
  if(current) neckColor=current;
  if(!neckColor) {
    neckSample.ctx.clearRect(0,0,64,64);
    neckSample.ctx.drawImage(headLayer.canvas,head.cx-head.chinWidth*.32,head.bottom-length*.20,head.chinWidth*.64,length*.07,0,0,64,64);
    neckColor=neckColorFromPixels(neckSample.ctx.getImageData(0,0,64,64).data);
  }
  neckReady=Boolean(neckColor);
  if(!neckReady) return;
  neckLayer.ctx.globalCompositeOperation='source-over'; neckLayer.ctx.clearRect(0,0,128,192);
  neckLayer.ctx.fillStyle=`rgb(${neckColor.join(',')})`; neckLayer.ctx.fillRect(0,0,128,192);
  neckLayer.ctx.globalCompositeOperation='destination-in'; neckLayer.ctx.drawImage(neckMask.canvas,0,0);
  neckLayer.ctx.globalCompositeOperation='source-over';
}

function neckBridge(pose) {
  if(!neckReady) return;
  const length=head.bottom-head.top;
  const reach=Math.min(pose.height*.07,length*.11);
  const topX=pose.x+Math.sin(pose.angle)*reach;
  const topY=pose.y-Math.cos(pose.angle)*reach;
  const lowerY=head.bottom+length*.15,span=lowerY-topY;
  ctx.save();
  ctx.transform(1,0,(pose.anchorX-topX)/span,1,topX,topY);
  ctx.drawImage(neckLayer.canvas,-head.chinWidth*1.18,0,head.chinWidth*2.36,span);
  ctx.restore();
}

function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  if (ready && tracked && head && !stopped) {
    const view = layout();
    ctx.save();
    ctx.translate(view.x + frame.canvas.width * view.scale, view.y);
    ctx.scale(-view.scale, view.scale);
    ctx.drawImage(body.canvas, 0, 0);
    if (!state.exploded) {
      lastPose = headPose(now, view);
      neckBridge(lastPose);
      ctx.translate(lastPose.x, lastPose.y); ctx.rotate(lastPose.angle);
      ctx.drawImage(balloon.render(state.pressure,neckColor,head.chinWidth*1.5/lastPose.width), -lastPose.width/2, -lastPose.height, lastPose.width, lastPose.height);
    }
    ctx.restore();
  }
  for (const piece of particles) {
    ctx.save(); ctx.globalAlpha = Math.min(1, Math.max(0, (piece.life - piece.age) / 1.1));
    ctx.translate(piece.x, piece.y); ctx.rotate(piece.angle);
    ctx.scale(Math.cos(piece.flip), Math.cos(piece.tilt));
    ctx.beginPath();
    piece.polygon.forEach((point,i) => { if(i) ctx.lineTo(point.x,point.y); else ctx.moveTo(point.x,point.y); });
    ctx.closePath(); ctx.clip();
    ctx.drawImage(debris.canvas, -piece.offsetX, -piece.offsetY, piece.width, piece.height);
    // 背面較暗，翻面時會收成細線，呈現薄膜厚度。
    if(Math.cos(piece.flip)*Math.cos(piece.tilt)<0) {
      ctx.fillStyle='rgba(46,30,22,0.28)'; ctx.fillRect(-piece.offsetX,-piece.offsetY,piece.width,piece.height);
    }
    ctx.restore();
  }
}

function explode() {
  rupture=ruptureProfile();
  const pose = lastPose || headPose(performance.now(), layout());
  // 凍結已著色球面；鏡像與主畫面一致，初始碎片可拼回氣球。
  debris.canvas.width = debris.canvas.height = 512;
  debris.ctx.save(); debris.ctx.translate(512,0); debris.ctx.scale(-1,1);
  debris.ctx.drawImage(balloon.canvas,0,0); debris.ctx.restore();
  const view=pose.view, w=pose.width*view.scale, h=pose.height*view.scale;
  const angle=-pose.angle, cosine=Math.cos(angle), sine=Math.sin(angle);
  const centerX=view.x+(frame.canvas.width-pose.x)*view.scale;
  const centerY=view.y+pose.y*view.scale;
  particles=fractureBalloon().map(cell => {
    const dx=cell.center.x*w/2, dy=(cell.center.y-1)*h/2;
    const mass=.8+Math.random()*.6;
    return {
      polygon:cell.polygon.map(p=>({x:(p.x-cell.center.x)*w/2,y:(p.y-cell.center.y)*h/2})),
      x:centerX+dx*cosine-dy*sine, y:centerY+dx*sine+dy*cosine,
      width:w,height:h,offsetX:(cell.center.x+1)*w/2,offsetY:(cell.center.y+1)*h/2,
      vx:cell.center.x*(170+Math.random()*120),vy:cell.center.y*(120+Math.random()*90)-90,
      angle,spin:(Math.random()-.5)*3.8,flip:0,tilt:0,
      flipSpeed:(Math.random()>.5?1:-1)*(2+Math.random()*4),tiltSpeed:(Math.random()-.5)*3,
      drag:(.7+Math.sqrt(cell.area)*1.3)/mass,phase:Math.random()*Math.PI*2,
      age:0,life:4.6+Math.random()*2.1
    };
  });
  sound(true); updateUI();
}

function tick(now) {
  if (stopped || document.hidden) return;
  const dt = Math.min((now - (lastTime || now)) / 1000, 0.05);
  lastTime = now;
  try {
    if (segmenter && detector && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime; infer(now);
    }
    // 裝置暫停供幀時，不讓使用者對著過期的人像繼續打氣。
    if (ready && now - lastFrameAt > 750) { tracked = false; swing=resetSwing(); updateUI(); }
    if(tracked) advanceSwing(swing,dt);
    for (const piece of particles) advanceShard(piece, dt);
    particles = particles.filter(piece => piece.age < piece.life);
    // 先計算上限附近的繪圖姿態，再用同一姿態切成碎片。
    const burst = advance(state, dt, tracked,maxScale);
    if (burst) {
      state.exploded = false; draw(now); state.exploded = true; explode();
    }
    draw(now);
    raf = requestAnimationFrame(tick);
  } catch (error) { fail(error, '人像處理失敗，請重新整理，或改用 Chrome／Edge。'); }
}

function release() {
  if (stopped) return;
  stopped = true; tracked = false; ready = false;
  clearTimeout(cameraTimer); clearTimeout(startupTimer); cancelAnimationFrame(raf);
  video.pause();
  stream?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  for (const model of [segmenter, detector]) {
    try { model?.close(); } catch { /* 關閉失敗不影響其餘資源釋放。 */ }
  }
  segmenter = detector = null;
  if (audio) { try { void audio.close().catch(() => {}); } catch {} audio = null; }
  particles = []; bodyPixels = headPixels = null;
  rupture=null; neckColor=null; neckReady=false;
  balloon?.release(); balloon = null;
  for (const layer of [frame, body, headLayer, bodyMask, headMask, debris,neckSample,neckLayer,neckMask]) layer.canvas.width = layer.canvas.height = 1;
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', visibility);
  updateUI(); draw(performance.now());
}

function fail(error, message) {
  if (stopped) return;
  console.error('[exploding-head]', error);
  release(); shell.showError(t(message));
}

function visibility() {
  cancelAnimationFrame(raf); lastTime = 0;
  swing=resetSwing();
  if (document.hidden) {
    clearTimeout(startupTimer);
    if (audio?.state === 'running') void audio.suspend().catch(() => {});
  } else if (!stopped) {
    tracked = false; lastVideoTime = -1;
    if (stream && !ready) watchStartup();
    if (segmenter && detector) raf = requestAnimationFrame(tick);
  }
  updateUI();
}

function watchStartup() {
  clearTimeout(startupTimer);
  if (!document.hidden) startupTimer = setTimeout(() => fail(new Error('Startup timed out'), '本地模型或影格載入逾時，請確認檔案完整後重新整理。'), 45000);
}

async function camera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires localhost or HTTPS');
  // 權限視窗可能晚於逾時或離頁才回應，晚到的 stream 也必須關閉。
  const pending = navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 720, facingMode: 'user' }, audio: false });
  pending.then(value => { if (stopped) value.getTracks().forEach(track => track.stop()); }, () => {});
  try {
    stream = await Promise.race([pending, new Promise((_, reject) => {
      cameraTimer = setTimeout(() => reject(new Error('Camera permission timed out')), 20000);
    })]);
  } finally { clearTimeout(cameraTimer); }
  if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
  for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
    fail(new Error('Camera stream ended'), '攝影機已中斷，請確認裝置連接後重新整理。');
  });
  video.srcObject = stream;
  watchStartup();
  await video.play();
}

async function start() {
  updateUI(); resize();
  shell.showLoading(t('正在準備攝影機與本地模型…'));
  try { balloon = createBalloon(document); }
  catch (error) { fail(error, '無法建立 3D 氣球，請啟用瀏覽器硬體加速，並使用 Chrome／Edge 重新整理。'); return; }
  try { await camera(); }
  catch (error) {
    fail(error, '無法開啟攝影機，請允許攝影機權限、關閉占用相機的程式，再經 start.bat 或 HTTPS 開啟並重新整理。');
    return;
  }
  if (stopped) return;
  watchStartup();
  try {
    const { FilesetResolver, ImageSegmenter, FaceDetector } = await import('../../libs/mediapipe/vision_bundle.mjs');
    if (stopped) return;
    const fileset = await FilesetResolver.forVisionTasks('../../libs/mediapipe/wasm');
    if (stopped) return;
    const createdSegmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '../../libs/mediapipe/selfie_segmenter.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true
    });
    if (stopped) { createdSegmenter.close(); return; }
    segmenter = createdSegmenter;
    const createdDetector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '../../libs/mediapipe/blaze_face_short_range.tflite', delegate: 'CPU' },
      runningMode: 'VIDEO', minDetectionConfidence: 0.6
    });
    if (stopped) { createdDetector.close(); return; }
    detector = createdDetector;
    if (!document.hidden) { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
  } catch (error) { fail(error, '本地人像模型載入失敗，請確認 libs/mediapipe 檔案完整，並經 start.bat 或 HTTPS 開啟。'); }
}

window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', visibility);
window.addEventListener('pagehide', release, { once: true });
// 返回快取頁面時模型與串流已釋放，重新初始化整個效果。
window.addEventListener('pageshow', event => { if (event.persisted && stopped) location.reload(); });
void start();
