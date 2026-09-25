import { clamp } from './physics.mjs';
import { projectPoint,roomSurfaces,roomHalfWidth,drawRoom,drawRoomShadow } from './room.mjs';

// 量測 flower.png 的有效像素：根部在底邊，綁點位於花頭下方的莖上。
export const FLOWER={width:1024,height:1536,centerX:512,top:47,bottom:1535,tieY:690,tieRadius:15};

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
  const assets={flower:null,ready:null,release(){
    if(released)return;released=true;timers.forEach(clearTimeout);
    images.forEach(image=>{image.onload=image.onerror=null;image.removeAttribute('src');});
    pending.forEach(reject=>reject(new Error('Scene images released')));
    assets.flower=null;
  }};
  assets.ready=load('./flower.png').then(flower=>{if(!released)assets.flower=flower;});
  return assets;
}

function rotateFlowerPoint(view,x,y) {
  const angle=view.flower?.angle||0,cos=Math.cos(angle),sin=Math.sin(angle);
  return {x:view.x+x*cos-y*sin,y:view.ground+x*sin+y*cos};
}

export function updateFlowerAnchor(view) {
  const scale=view.flowerScale, point=rotateFlowerPoint(view,0,(FLOWER.tieY-FLOWER.bottom)*scale);
  view.anchor.x=point.x;view.anchor.y=point.y;
  return view.anchor;
}

// 構圖只依視窗，鏡頭距離、氣量與最大尺寸都不改變小花大小。
export function sceneLayout(width,height) {
  const span=Math.max(100,height-(height<500?150:178)-74),baseUnit=Math.min(span,width*1.18),unit=baseUnit*1.15;
  // 共用鏡頭尺度與地板位移，讓球、花、繩及投影一起拉近而不脫節。
  const x=width/2,ground=height-(height<500?180:145)-(height<500?0:baseUnit*.25)+baseUnit*.15;
  const flowerHeight=unit*.30,flowerScale=flowerHeight/(FLOWER.bottom-FLOWER.top);
  const baseRopeLength=unit*(.44*825/1464+.22);
  const view={width,height,x,ground,unit,flower:{angle:0},
    perspective:.5,depthScale:.52,roadSlope:0,roomHalf:roomHalfWidth(0),
    nearDepth:-.65,farDepth:.3,flowerHeight,flowerScale,baseSize:unit*.195,
    anchor:{x:0,y:0},baseRopeLength,ropeLength:baseRopeLength};
  updateFlowerAnchor(view);
  view.road=roomSurfaces(view)[0].points.map(p=>projectPoint(view,p.x,p.z,p.height));
  return view;
}

export function setRopeLength(view,tether,multiplier) {
  updateFlowerAnchor(view);
  const next=view.baseRopeLength*clamp(multiplier,.6,2.5),ratio=next/view.ropeLength;
  view.ropeLength=next;
  if(!tether) return;
  for(const point of tether.points) {
    for(const key of ['x','px']) point[key]=view.anchor.x+(point[key]-view.anchor.x)*ratio;
    for(const key of ['y','py']) point[key]=Math.min(view.ground-2,view.anchor.y+(point[key]-view.anchor.y)*ratio);
  }
}

export function createTether(view) {
  view.flower.angle=0;updateFlowerAnchor(view);
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
    const wind=(Math.sin(time*.00067)*.7+Math.sin(time*.00173)*.3)*1.5;
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
        if(b.y>view.ground-2) { b.y=view.ground-2; b.py=b.y; }
      }
    }
    points[0].x=points[0].px=view.anchor.x; points[0].y=points[0].py=view.anchor.y;
    const end=points[last],before=points[last-1];
    const target=clamp(Math.atan2(end.x-before.x,before.y-end.y)*.65+(!exploded?(swing.roll||0)*.4:0),-.75,.75);
    tether.angle+=(target-tether.angle)*(1-Math.exp(-5*step));
    tether.velocity.x=(end.x-end.px)/step; tether.velocity.y=(end.y-end.py)/step;
  }
  // 花使用繩子的第一段方向，延遲一幀跟隨；爆炸後繩子自然垂下，角度回正。
  const first=tether.points[1],root=tether.points[0];
  const ropeTarget=clamp(Math.atan2(first.x-root.x,root.y-first.y)*.55,-.35,.35);
  view.flower.angle+=(ropeTarget-view.flower.angle)*(1-Math.exp(-6*dt));
  updateFlowerAnchor(view);
  points[0].x=points[0].px=view.anchor.x;points[0].y=points[0].py=view.anchor.y;
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
  if(!assets?.flower)return;
  // 花頭、葉片與莖合成一個投影輪廓，並繞根部套用同一個擺動角度。
  const scale=view.flowerScale;
  const outline=[
    [
      [512,1535],[490,1535],[490,760],[420,720],[330,665],[235,570],[176,430],
      [215,280],[330,130],[512,47],[700,110],[820,250],[855,420],[810,565],
      [705,660],[610,720],[535,760],[535,1535]
    ].map(([x,y])=>{
      const p=rotateFlowerPoint(view,(x-FLOWER.centerX)*scale,(FLOWER.bottom-y)*-scale);
      // projectShadow 要的是世界單位；這裡的 p 是旋轉後畫布像素，需先除回場景 unit。
      return {x:(p.x-view.x)/view.unit,z:0,height:(view.ground-p.y)/view.unit};
    })
  ];
  drawRoomShadow(ctx,view,outline,.65);
}

export function drawFlower(ctx,view,assets) {
  if(!assets?.flower)return;
  const s=view.flowerScale,r=Math.max(FLOWER.tieRadius*s,view.baseSize*.045),y=(FLOWER.tieY-FLOWER.bottom)*s;
  ctx.save();ctx.strokeStyle='#87755a';ctx.lineWidth=Math.max(1,view.baseSize*.014);
  ctx.translate(view.x,view.ground);ctx.rotate(view.flower.angle);
  ctx.beginPath();ctx.ellipse(0,y,r,r*.27,0,Math.PI,Math.PI*2);ctx.stroke();
  ctx.drawImage(assets.flower,-FLOWER.centerX*s,-FLOWER.bottom*s,FLOWER.width*s,FLOWER.height*s);
  ctx.strokeStyle='#b4a183';ctx.beginPath();ctx.ellipse(0,y,r,r*.27,0,0,Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(-r*.22,y+r*.30);ctx.lineTo(r*.20,y+r*.28);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.moveTo(r*.15,y+r*.25);ctx.lineTo(r*.32,y+r*.70);ctx.stroke();ctx.restore();
}

export function drawTether(ctx,tether,view,pose) {
  ctx.strokeStyle='#776a55';ctx.lineWidth=Math.max(1,view.baseSize*.014);ctx.lineCap='round';
  ctx.beginPath();tether.points.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();
  if(!pose) return;
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);
  ctx.fillStyle='#b47c64';ctx.beginPath();ctx.moveTo(-2,-pose.height*.009);ctx.lineTo(2,-pose.height*.009);ctx.lineTo(3,pose.knot*.78);ctx.lineTo(0,pose.knot);ctx.lineTo(-3,pose.knot*.78);ctx.closePath();ctx.fill();ctx.restore();
}
