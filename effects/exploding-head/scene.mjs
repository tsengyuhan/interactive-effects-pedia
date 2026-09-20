import { clamp } from './physics.mjs';
import { projectPoint,roomSurfaces,roomHalfWidth,drawRoom,drawRoomShadow } from './room.mjs';

export const BOTTLE={width:1024,height:1536,centerX:509,top:51,bottom:1360,neckY:320,neckRadius:80};

export function createSceneAssets(document) {
  let released=false;
  const pending=[],images=[],timers=[];
  const load=path=>new Promise((resolve,reject)=>{
    const image=document.createElement('img');images.push(image);pending.push(reject);
    const timer=setTimeout(()=>reject(new Error(`Scene image timed out: ${path}`)),15000);timers.push(timer);
    image.onload=()=>{clearTimeout(timer);if(!released)resolve(image);};
    image.onerror=()=>{clearTimeout(timer);reject(new Error(`Scene image unavailable: ${path}`));};
    image.src=path;
  });
  const assets={bottle:null,ready:null,release(){
    if(released)return;released=true;timers.forEach(clearTimeout);
    images.forEach(image=>{image.onload=image.onerror=null;image.removeAttribute('src');});
    pending.forEach(reject=>reject(new Error('Scene images released')));
    assets.bottle=null;
  }};
  assets.ready=load('./bottle.png').then(bottle=>{if(!released)assets.bottle=bottle;});
  return assets;
}

// 構圖只依視窗，鏡頭距離、氣量與最大尺寸都不改變酒瓶大小。
export function sceneLayout(width,height) {
  const span=Math.max(100,height-(height<500?150:178)-74),baseUnit=Math.min(span,width*1.18),unit=baseUnit*1.15;
  // 共用鏡頭尺度與地板位移，讓球、瓶、繩及投影一起拉近而不脫節。
  const x=width/2,ground=height-(height<500?180:145)-(height<500?0:baseUnit*.25)+baseUnit*.15;
  const bottleHeight=unit*.44,bottleScale=bottleHeight/(BOTTLE.bottom-BOTTLE.top);
  // 瓶頸比原綁點高，縮短基準繩長以保持原本球底高度。
  const neckHeight=(BOTTLE.bottom-BOTTLE.neckY)*bottleScale;
  const baseRopeLength=unit*(.44*825/1464+.22)-neckHeight;
  const view={width,height,x,ground,bottleGround:ground,tetherGround:ground,unit,
    perspective:.5,depthScale:.52,roadSlope:0,roomHalf:roomHalfWidth(0),
    nearDepth:-.65,farDepth:.3,bottleHeight,bottleScale,baseSize:unit*.195,
    anchor:{x,y:ground-neckHeight},baseRopeLength,ropeLength:baseRopeLength};
  view.road=roomSurfaces(view)[0].points.map(p=>projectPoint(view,p.x,p.z,p.height));
  return view;
}

export function setRopeLength(view,tether,multiplier) {
  const next=view.baseRopeLength*clamp(multiplier,.6,1.5),ratio=next/view.ropeLength;
  view.ropeLength=next;
  if(!tether) return;
  for(const point of tether.points) {
    for(const key of ['x','px']) point[key]=view.anchor.x+(point[key]-view.anchor.x)*ratio;
    for(const key of ['y','py']) point[key]=Math.min(view.tetherGround-2,view.anchor.y+(point[key]-view.anchor.y)*ratio);
  }
}

export function createTether(view) {
  const points=Array.from({length:13},(_,i)=>{
    const t=i/12,x=view.anchor.x;
    const y=view.anchor.y-view.ropeLength*t;
    return {x,y,px:x,py:y};
  });
  return {points,angle:0,velocity:{x:0,y:0}};
}

export function advanceTether(tether, view, dt, time, swing, exploded) {
  const count=Math.max(1,Math.ceil(Math.min(dt,.05)*120)),step=Math.min(dt,.05)/count;
  if(!step) return;
  const points=tether.points,last=points.length-1,segment=view.ropeLength/last;
  const unit=view.ropeLength/120;
  for(let s=0;s<count;s++) {
    const wind=(Math.sin(time*.00067)*.7+Math.sin(time*.00173)*.3)*6;
    for(let i=1;i<=last;i++) {
      const p=points[i],vx=(p.x-p.px)*Math.exp(-1.65*step),vy=(p.y-p.py)*Math.exp(-1.65*step);
      p.px=p.x; p.py=p.y;
      const pull=i===last&&!exploded;
      // 直頭時只留零均值微風；移頭衝量與歪頭傾角各自帶動繩索。
      p.x+=vx+(wind*(pull?2:1)+(!exploded?swing.angle*5500+(swing.roll||0)*1400:0))*unit*step*step;
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
    const target=clamp(Math.atan2(end.x-before.x,before.y-end.y)*.65+(!exploded?(swing.roll||0)*.4:0),-.75,.75);
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

export function drawRoomScene(ctx,view,assets,primary) {
  drawRoom(ctx,view,primary);
  if(!assets?.bottle)return;
  // 身體肩部與細瓶頸各為凸輪廓，合併投影後才柔化，避免重疊處加深。
  const scale=view.bottleScale/view.unit;
  const outline=[
    [[254,1360],[766,1360],[766,575],[590,430],[426,430],[254,575]],
    [[420,430],[600,430],[600,51],[420,51]]
  ].map(polygon=>polygon.map(([x,y])=>({x:(x-BOTTLE.centerX)*scale,z:0,height:(BOTTLE.bottom-y)*scale})));
  drawRoomShadow(ctx,view,outline,.65);
}

export function drawBottle(ctx,view,assets) {
  if(!assets?.bottle)return;
  const s=view.bottleScale,r=BOTTLE.neckRadius*s,y=view.anchor.y;
  ctx.save();ctx.strokeStyle='#87755a';ctx.lineWidth=Math.max(1,view.baseSize*.014);
  ctx.beginPath();ctx.ellipse(view.anchor.x,y,r,r*.27,0,Math.PI,Math.PI*2);ctx.stroke();
  ctx.drawImage(assets.bottle,view.x-BOTTLE.centerX*s,view.bottleGround-BOTTLE.bottom*s,BOTTLE.width*s,BOTTLE.height*s);
  ctx.strokeStyle='#b4a183';ctx.beginPath();ctx.ellipse(view.anchor.x,y,r,r*.27,0,0,Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(view.anchor.x,y);ctx.lineTo(view.anchor.x-r*.22,y+r*.30);ctx.lineTo(view.anchor.x+r*.20,y+r*.28);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.moveTo(view.anchor.x+r*.15,y+r*.25);ctx.lineTo(view.anchor.x+r*.32,y+r*.70);ctx.stroke();ctx.restore();
}

export function drawTether(ctx,tether,view,pose) {
  ctx.strokeStyle='#776a55';ctx.lineWidth=Math.max(1,view.baseSize*.014);ctx.lineCap='round';
  ctx.beginPath();tether.points.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();
  if(!pose) return;
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);
  ctx.fillStyle='#b47c64';ctx.beginPath();ctx.moveTo(-2,-pose.height*.009);ctx.lineTo(2,-pose.height*.009);ctx.lineTo(3,pose.knot*.78);ctx.lineTo(0,pose.knot);ctx.lineTo(-3,pose.knot*.78);ctx.closePath();ctx.fill();ctx.restore();
}
