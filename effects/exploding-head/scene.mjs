import { clamp } from './physics.mjs';

export function createStreetAssets(document) {
  let released=false;
  const pending=[],images=[],timers=[];
  const load=path=>new Promise((resolve,reject)=>{
    const image=document.createElement('img');images.push(image);pending.push(reject);
    const timer=setTimeout(()=>reject(new Error(`Street image timed out: ${path}`)),15000);timers.push(timer);
    image.onload=()=>{clearTimeout(timer);if(!released)resolve(image);};
    image.onerror=()=>{clearTimeout(timer);reject(new Error(`Street image unavailable: ${path}`));};
    image.src=path;
  });
  const assets={street:null,hydrant:null,ready:null,release(){
    if(released)return;released=true;timers.forEach(clearTimeout);
    images.forEach(image=>{image.onload=image.onerror=null;image.removeAttribute('src');});
    pending.forEach(reject=>reject(new Error('Street images released')));
    assets.street=assets.hydrant=null;
  }};
  assets.ready=Promise.all([load('./street.png'),load('./hydrant.png')]).then(([street,hydrant])=>{
    if(!released){assets.street=street;assets.hydrant=hydrant;}
  });
  return assets;
}

// 構圖只依視窗，鏡頭距離、氣量與最大尺寸都不改變消防栓大小。
export function sceneLayout(width,height) {
  const span=Math.max(100,height-(height<500?150:178)-74),unit=Math.min(span,width*1.18);
  const imageScale=Math.max(width/1536,height/1024)*1.6;
  const imageX=(width-1536*imageScale)/2-unit*.15;
  const imageY=clamp(height-(height<500?120:160)-650*imageScale,height-1024*imageScale,0);
  // 拉近同一街景，栓腳移到路緣內側，讓柏油前景仍容得下落片。
  const x=imageX+768*imageScale,hydrantGround=imageY+552*imageScale;
  const ground=imageY+650*imageScale,hydrantHeight=unit*.44,hydrantScale=hydrantHeight/1464;
  return {width,height,x,ground,hydrantGround,tetherGround:hydrantGround,unit,
    image:{x:imageX,y:imageY,scale:imageScale},perspective:.5,depthScale:.32,roadSlope:269/1536,
    nearDepth:-.14,farDepth:.16,
    road:[{x:imageX,y:imageY+486*imageScale},{x:imageX+1536*imageScale,y:imageY+755*imageScale},
      {x:width,y:height},{x:0,y:height}],hydrantHeight,hydrantScale,baseSize:unit*.195,
    anchor:{x:x+(775-516)*hydrantScale,y:hydrantGround+(635-1460)*hydrantScale},ropeLength:unit*.22};
}

export function createTether(view) {
  const points=Array.from({length:13},(_,i)=>{
    const t=i/12,x=view.anchor.x+view.ropeLength*.80*t;
    const y=view.anchor.y-view.ropeLength*.60*t;
    return {x,y,px:x,py:y};
  });
  return {points,angle:.58,velocity:{x:0,y:0}};
}

export function advanceTether(tether, view, dt, time, swing, exploded) {
  const count=Math.max(1,Math.ceil(Math.min(dt,.05)*120)),step=Math.min(dt,.05)/count;
  if(!step) return;
  const points=tether.points,last=points.length-1,segment=view.ropeLength/last;
  const unit=view.ropeLength/120;
  for(let s=0;s<count;s++) {
    const wind=(Math.sin(time*.00067)*.7+Math.sin(time*.00173)*.3)*38;
    for(let i=1;i<=last;i++) {
      const p=points[i],vx=(p.x-p.px)*Math.exp(-1.65*step),vy=(p.y-p.py)*Math.exp(-1.65*step);
      p.px=p.x; p.py=p.y;
      const pull=i===last&&!exploded;
      // 固定側風讓球從右側管往外飄，露出繩段；移頭慣性疊加其上。
      p.x+=vx+(wind*(pull?2:1)+(pull?1000:0)+(!exploded?swing.angle*5500:0))*unit*step*step;
      p.y+=vy+(pull?-750:210)*unit*step*step;
    }
    // 多段繩長約束傳遞張力；爆炸只移除浮力，繩仍留在原綁點。
    for(let iteration=0;iteration<32;iteration++) {
      points[0].x=view.anchor.x; points[0].y=view.anchor.y;
      for(let i=0;i<last;i++) {
        const a=points[i],b=points[i+1],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
        const correction=(length-segment)/length,wa=i===0?0:1,wb=i+1===last&&!exploded?.24:1;
        a.x+=dx*correction*wa/(wa+wb); a.y+=dy*correction*wa/(wa+wb);
        b.x-=dx*correction*wb/(wa+wb); b.y-=dy*correction*wb/(wa+wb);
        // 路面吸收落繩，避免穿出畫面。
        if(b.y>view.tetherGround-2) { b.y=view.tetherGround-2; b.py=b.y; }
      }
    }
    points[0].x=points[0].px=view.anchor.x; points[0].y=points[0].py=view.anchor.y;
    const end=points[last],before=points[last-1];
    const target=clamp(Math.atan2(end.x-before.x,before.y-end.y)*.65,-.75,.75);
    tether.angle+=(target-tether.angle)*(1-Math.exp(-5*step));
    tether.velocity.x=(end.x-end.px)/step; tether.velocity.y=(end.y-end.py)/step;
  }
}

export function scenePose(view,tether,state) {
  const end=tether.points[tether.points.length-1],squash=clamp(state.velocity*.022,-.035,.055);
  const height=view.baseSize*state.scale*(1-squash*.7),width=view.baseSize*.93*state.scale*(1+state.pressure*.12)*(1+squash);
  const knot=Math.max(4,view.baseSize*.065),angle=tether.angle;
  // 球底、短氣嘴與繩終點使用同一個旋轉座標，放大後仍不脫節。
  return {x:end.x+knot*Math.sin(angle),y:end.y-knot*Math.cos(angle),width,height,angle,knot};
}

function ellipse(ctx,x,y,rx,ry,color) {
  ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill();
}

export function drawStreet(ctx,view,assets,background) {
  if(!assets?.street)return;
  const image=view.image,h=view.hydrantHeight;
  ctx.drawImage(assets.street,image.x,image.y,1536*image.scale,1024*image.scale);
  ctx.save();ctx.globalAlpha=.08;ctx.globalCompositeOperation='color';ctx.fillStyle=background;
  ctx.fillRect(0,0,view.width,view.height);ctx.restore();
  ctx.save();ctx.filter=`blur(${Math.max(1,h*.025)}px)`;
  ellipse(ctx,view.x+h*.21,view.hydrantGround-h*.04,h*.42,h*.10,'rgba(25,27,30,.19)');
  ctx.restore();
  ellipse(ctx,view.x,view.hydrantGround,h*.23,h*.035,'rgba(25,27,30,.3)');
}

export function drawHydrant(ctx,view,assets) {
  if(!assets?.hydrant)return;
  const s=view.hydrantScale;
  ctx.drawImage(assets.hydrant,view.x-516*s,view.hydrantGround-1460*s,1024*s,1536*s);
  ctx.save();ctx.strokeStyle='#b8a88b';ctx.lineWidth=Math.max(.7,view.baseSize*.011);
  ctx.beginPath();ctx.ellipse(view.anchor.x-2*s,view.anchor.y+37*s,12*s,48*s,-.15,-1.7,1.7);ctx.stroke();ctx.restore();
}

export function drawTether(ctx,tether,view,pose) {
  ctx.strokeStyle='#776a55';ctx.lineWidth=Math.max(1,view.baseSize*.014);ctx.lineCap='round';
  ctx.beginPath();tether.points.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();
  if(!pose) return;
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);
  ctx.fillStyle='#b47c64';ctx.beginPath();ctx.moveTo(-2,-pose.height*.009);ctx.lineTo(2,-pose.height*.009);ctx.lineTo(3,pose.knot*.78);ctx.lineTo(0,pose.knot);ctx.lineTo(-3,pose.knot*.78);ctx.closePath();ctx.fill();ctx.restore();
}
