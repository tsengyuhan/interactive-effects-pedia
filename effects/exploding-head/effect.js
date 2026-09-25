import { MAX_SCALE, resetState, pump, advance, estimateHead, fractureBalloon, resetSwing, trackSwing, trackRoll, advanceSwing } from './physics.mjs';
import { createSceneAssets,sceneLayout,createTether,setRopeLength,advanceTether,scenePose,drawRoomScene,drawFlower,drawGrass,drawTether } from './scene.mjs';
import { placeShard,advanceGroundShard,advanceWindShard,shardPose,clipRoad,drawBalloonShadow,drawShardShadow } from './ground.mjs';
import { createBalloon } from './balloon.mjs';

const shell = Shell.init({ id: 'exploding-head' });
const canvas = document.createElement('canvas');
canvas.className = 'exploding-stage';
canvas.setAttribute('aria-label', t('小花上的臉部氣球'));
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
const frame=surface(),headLayer=surface(),headMask=surface(),debris=surface();
let headPixels;
let state = resetState();
let background = '#63b7ac', speed = 1, maxScale=MAX_SCALE, fisheye=.25, ropeScale=1;
let resetElapsed=null;
let swing=resetSwing();
let stream, segmenter, detector, audio;
let stopped = false, ready = false, tracked = false, head = null;
let raf = 0, lastTime = 0, lastVideoTime = -1, lastFrameAt = 0;
let width = 1, height = 1, dpr = 1, cameraTimer = 0, startupTimer = 0;
let particles = [], lastPose = null;
let scene=null,tether=null,hasTexture=false,cameraWidth=0,cameraHeight=0;
let balloon,sceneAssets;

const controls = document.createElement('div');
controls.className = 'exploding-controls';
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
controls.append(meter, button);
shell.container.append(controls);

function canReset() {
  return state.exploded && resetElapsed===null && particles.length>0 && particles.every(piece=>piece.landed);
}

function updateUI() {
  const falling=state.exploded && resetElapsed===null && !canReset();
  button.textContent=t(resetElapsed!==null?'吹走碎片中…':falling?'碎片飄落中…':state.exploded?'重置':'打氣');
  button.disabled = stopped || resetElapsed!==null || falling || document.hidden || (!state.exploded && (!ready || !tracked || state.pressure >= 1));
  progress.value = state.pressure;
  percent.textContent = `${Math.round(state.pressure * 100)}%`;
}

shell.addParam({ type: 'color', key: 'background', label: '主色調', value: background,
  onChange: value => { background = value; draw(performance.now()); } });
shell.addParam({ type: 'range', key: 'speed', label: '充氣速度', min: 0.5, max: 2, step: 0.25, value: speed,
  onChange: value => { speed = value; } });
shell.addParam({type:'range',key:'fisheye',label:'魚眼程度',min:0,max:1,step:.05,value:fisheye,
  onChange:value=>{fisheye=Number(value);draw(performance.now());}});
shell.addParam({type:'range',key:'ropeScale',label:'繩長（倍）',min:.6,max:2.5,step:.05,value:ropeScale,
  onChange:value=>{ropeScale=Number(value);if(scene)setRopeLength(scene,tether,ropeScale);draw(performance.now());}});
shell.addParam({ type:'range',key:'maxScale',label:'氣球最大尺寸（倍）',min:1.5,max:4,step:.05,value:maxScale,
  onChange:value=>{
    maxScale=Number(value);
    const target=1+state.pressure*(maxScale-1);
    if(state.scale>target) { state.scale=target; state.velocity=Math.min(0,state.velocity); }
  } });

function resetEffect() {
  if (stopped) return;
  if(resetElapsed!==null) return;
  if(state.exploded) {if(canReset()) {resetElapsed=0;updateUI();}return;}
  finishReset();
}

function finishReset() {
  resetElapsed=null;
  state = resetState(); particles = []; lastPose = null;
  if(scene) tether=createTether(scene);
  swing=resetSwing();
  debris.canvas.width = debris.canvas.height = 1;
  updateUI();
}

function advanceReset(dt) {
  if(resetElapsed===null) return;
  const elapsed=Math.min(dt,2-resetElapsed);
  resetElapsed+=elapsed;
  for(const piece of particles) advanceWindShard(piece,elapsed,scene,resetElapsed);
  if(resetElapsed>=2) finishReset();
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
  scene=sceneLayout(width,height);setRopeLength(scene,null,ropeScale);tether=createTether(scene);
  draw(performance.now());
}

function infer(now) {
  const w = Math.min(video.videoWidth, 640);
  const h = Math.round(video.videoHeight * w / video.videoWidth);
  if (w < 1 || h < 1) return;
  if (cameraWidth !== video.videoWidth || cameraHeight !== video.videoHeight) {
    swing=resetSwing();
    cameraWidth = video.videoWidth; cameraHeight = video.videoHeight;
  }
  for (const layer of [frame, headLayer]) {
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
    // 臉框中心不受髮型、前景遮罩寬度影響，左右移頭能直接帶動繩端。
    if(head) {
      const face=detections[0],box=face.boundingBox;
      trackSwing(swing,box.originX+box.width/2,now,w);trackRoll(swing,face.keypoints,now,w,h);
    }
    else swing=resetSwing();
    if (!headPixels || headPixels.width !== mask.width || headPixels.height !== mask.height) {
      headMask.canvas.width=mask.width; headMask.canvas.height=mask.height;
      headPixels=headMask.ctx.createImageData(mask.width,mask.height);
    }
    // 只擷取臉部貼圖所需前景，不再輸出肩頸。
    for(let i=0;i<data.length;i++) headPixels.data[i*4+3]=Math.round(Math.max(0,Math.min(1,(data[i]-.38)/.42))*255);
    headMask.ctx.putImageData(headPixels,0,0);
    headLayer.ctx.clearRect(0,0,w,h); headLayer.ctx.drawImage(frame.canvas,0,0);
    headLayer.ctx.globalCompositeOperation='destination-in';headLayer.ctx.drawImage(headMask.canvas,0,0,w,h);
    headLayer.ctx.globalCompositeOperation='source-over';
    if(head && !state.exploded) { balloon.update(headLayer.canvas,head);hasTexture=true; }
    ready = true;
    lastFrameAt = now;
    clearTimeout(startupTimer);
    shell.hideLoading();
    updateUI();
  } finally { result?.close(); }
}

function layout() { return scene || sceneLayout(width,height); }

function headPose() { return scenePose(scene,tether,state); }

function drawPiece(piece) {
  const projected=shardPose(scene,piece),air=projected.airborne;
  ctx.save();
  if(piece.landed) clipRoad(ctx,scene);
  ctx.translate(projected.x,projected.y);
  // 落地時把薄片方向攤在路面平面，深度縮短與場景透視相同。
  ctx.scale(projected.size,projected.size);
  if(air<1) ctx.transform(1,scene.roadSlope*(1-air),piece.gx*scene.perspective*(1-air)*projected.scale,
    air+(1-air)*(scene.depthScale+scene.roadSlope*piece.gx*scene.perspective)*projected.scale,0,0);
  ctx.rotate(piece.angle);
  ctx.scale(air*Math.cos(piece.flip)+1-air,air*Math.cos(piece.tilt)+1-air);
  ctx.beginPath();
  piece.polygon.forEach((point,i) => { if(i) ctx.lineTo(point.x,point.y); else ctx.moveTo(point.x,point.y); });
  ctx.closePath();ctx.clip();
  ctx.drawImage(debris.canvas,-piece.offsetX,-piece.offsetY,piece.width,piece.textureHeight);
  if(Math.cos(piece.flip)*Math.cos(piece.tilt)<0) {
    ctx.fillStyle='rgba(46,30,22,0.28)';ctx.fillRect(-piece.offsetX,-piece.offsetY,piece.width,piece.textureHeight);
  }
  ctx.restore();
}

function draw(now) {
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  if(!scene || !tether) return;
  drawRoomScene(ctx,scene,sceneAssets,background);
  const visible=hasTexture && !state.exploded && !stopped;
  lastPose=visible?headPose():null;
  if(lastPose) drawBalloonShadow(ctx,scene,lastPose);
  for(const piece of particles) drawShardShadow(ctx,scene,piece);
  const ordered=[...particles].sort((a,b)=>b.gz-a.gz);
  for(const piece of ordered) if(piece.gz>=0) drawPiece(piece);
  drawGrass(ctx,scene);
  drawTether(ctx,tether,scene,lastPose);
  drawFlower(ctx,scene,sceneAssets);
  drawGrass(ctx,scene,true);
  if(lastPose) {
    ctx.save();ctx.translate(lastPose.x,lastPose.y);ctx.rotate(lastPose.angle);
    ctx.drawImage(balloon.render(state.pressure,fisheye),-lastPose.width/2,-lastPose.height,lastPose.width,lastPose.height);
    ctx.restore();
  }
  for(const piece of ordered) if(piece.gz<0) drawPiece(piece);
}

function explode() {
  const pose=lastPose || headPose();
  // 貼圖已鏡像，碎片沿用球體畫面座標。
  debris.canvas.width=debris.canvas.height=512;
  debris.ctx.drawImage(balloon.canvas,0,0);
  const w=pose.width,h=pose.height,angle=pose.angle,cosine=Math.cos(angle),sine=Math.sin(angle);
  const centerX=pose.x,centerY=pose.y;
  particles=fractureBalloon().map(cell => {
    const dx=cell.center.x*w/2, dy=(cell.center.y-1)*h/2;
    const mass=.8+Math.random()*.6;
    return placeShard(scene,{
      polygon:cell.polygon.map(p=>({x:(p.x-cell.center.x)*w/2,y:(p.y-cell.center.y)*h/2})),
      x:centerX+dx*cosine-dy*sine, y:centerY+dx*sine+dy*cosine,
      width:w,height:h,offsetX:(cell.center.x+1)*w/2,offsetY:(cell.center.y+1)*h/2,
      vx:cell.center.x*(170+Math.random()*120)+tether.velocity.x,vy:cell.center.y*(120+Math.random()*90)-90+tether.velocity.y,
      angle,spin:(Math.random()-.5)*3.8,flip:0,tilt:0,
      flipSpeed:(Math.random()>.5?1:-1)*(2+Math.random()*4),tiltSpeed:(Math.random()-.5)*3,
      drag:(.7+Math.sqrt(cell.area)*1.3)/mass,phase:Math.random()*Math.PI*2,
      age:0
    },(Math.random()-.5)*.1);
  });
  sound(true); updateUI();
}

function tick(now) {
  if (stopped || document.hidden) return;
  const elapsed = (now - (lastTime || now)) / 1000;
  const dt = Math.min(elapsed, 0.05);
  lastTime = now;
  try {
    if (segmenter && detector && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime; infer(now);
    }
    // 裝置暫停供幀時，不讓使用者對著過期的人像繼續打氣。
    if (ready && now - lastFrameAt > 750) { tracked = false; swing=resetSwing(); updateUI(); }
    if(tracked) advanceSwing(swing,dt);
    if(scene && tether) advanceTether(tether,scene,dt,now,swing,state.exploded);
    if(resetElapsed!==null) advanceReset(elapsed);
    else for (const piece of particles) advanceGroundShard(piece,dt,scene);
    if(state.exploded) updateUI();
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
  particles = []; resetElapsed=null; headPixels = null; hasTexture=false;
  balloon?.release(); balloon = null;
  sceneAssets?.release();sceneAssets=null;
  for (const layer of [frame, headLayer, headMask, debris]) layer.canvas.width = layer.canvas.height = 1;
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
  sceneAssets=createSceneAssets(document);
  const assetsReady=sceneAssets.ready.catch(error=>fail(error,'小花素材載入失敗，請確認圖片完整後重新整理。'));
  try { await camera(); }
  catch (error) {
    fail(error, '無法開啟攝影機，請允許攝影機權限、關閉占用相機的程式，再經 start.bat 或 HTTPS 開啟並重新整理。');
    return;
  }
  await assetsReady;
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
