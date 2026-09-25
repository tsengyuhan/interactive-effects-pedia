import { clamp,MAX_SCALE } from './physics.mjs';
import { projectPoint,roomSurfaces,roomHalfWidth,drawRoom,drawRoomShadow } from './room.mjs';

// 量測 flower.png 的有效像素：根部在底邊，綁點位於花頭下方的莖上。
export const FLOWER={width:1024,height:1536,centerX:512,top:47,stemTop:650,bottom:1535,tieY:690,tieRadius:15};

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

export function flowerPoint(view,imgX,imgY) {
  const scale=view.flowerScale,a=view.flower?.angle||0;
  const stemLength=(FLOWER.bottom-FLOWER.stemTop)*scale;
  const distance=Math.min((FLOWER.bottom-imgY)*scale,stemLength);
  const angle=a*distance/stemLength;
  // 小角度直接用極限式，避免曲率半徑除以零。
  const centerX=Math.abs(a)<1e-5?0:stemLength/a*(1-Math.cos(angle));
  const centerY=Math.abs(a)<1e-5?-distance:-stemLength/a*Math.sin(angle);
  const offset=(imgX-FLOWER.centerX)*scale;
  const extra=Math.max(0,FLOWER.stemTop-imgY)*scale;
  return {x:view.x+centerX+extra*Math.sin(a)+offset*Math.cos(angle),
    y:view.ground+centerY-extra*Math.cos(a)+offset*Math.sin(angle),angle};
}

function createGrass() {
  let seed=1729;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const clumps=[];
  const add=(x,z,height,count)=>clumps.push({x,z,blades:Array.from({length:count},(_,i)=>({
    height:height*(.4+random()*.6),
    lean:(i/(count-1)-.5)*1.8+(random()-.5)*.9,
    curl:.15+random()*.65,
    droop:random()<.34?.25+random()*.35:random()*.22,
    width:.0009+random()*.0008,
    dry:random()<.15,
    shade:Math.floor(random()*3)
  }))});
  // 根部一叢、外側成群且逐漸稀疏，避免草像等距插在地上。
  add(0,0,.066,12);
  for(const [ring,groups] of [[.038,5],[.085,7],[.137,7]]) {
    for(let group=0;group<groups;group++) {
      const direction=(group+random()*.65)*Math.PI*2/groups;
      const centerRadius=ring*(.82+random()*.35);
      const count=ring<.05?2:ring<.1?3:1;
      for(let i=0;i<count;i++) {
        const offset=(random()-.5)*(ring<.1?.024:.014);
        const radius=centerRadius+offset;
        const a=direction+(random()-.5)*.3;
        const height=(ring<.05?.05:ring<.1?.036:.021)*(.7+random()*.4);
        add(Math.cos(a)*radius,Math.sin(a)*radius,height,ring<.05?6+Math.floor(random()*3):ring<.1?4+Math.floor(random()*4):3+Math.floor(random()*3));
      }
    }
  }
  return clumps.sort((a,b)=>b.z-a.z);
}

export function drawGrass(ctx,view,front=false) {
  const colors=[['#4f6e2e','#8ea455'],['#49662b','#6b8a3c'],['#5c7633','#91a653']];
  for(const clump of view.grass) {
    if((clump.z<0)!==front)continue;
    const base=projectPoint(view,clump.x,clump.z);
    for(const blade of clump.blades) {
      const h=blade.height,lean=blade.lean;
      const tip=projectPoint(view,clump.x+lean*h*(.65+blade.curl),clump.z,h*(1-blade.droop));
      const rise=h*view.unit*base.scale;
      const drift=lean*rise;
      const width=Math.max(.65,view.unit*blade.width*base.scale);
      const gradient=ctx.createLinearGradient(base.x,base.y,tip.x,tip.y);
      const [dark,light]=blade.dry?['#77783a','#a9a46a']:colors[blade.shade];
      gradient.addColorStop(0,dark);gradient.addColorStop(1,light);
      ctx.fillStyle=gradient;
      ctx.beginPath();ctx.moveTo(base.x-width,base.y);
      ctx.bezierCurveTo(base.x+drift*.14-width,base.y-rise*.72,
        tip.x-drift*.2,base.y-rise*(1.12-blade.droop*.25),tip.x,tip.y);
      ctx.bezierCurveTo(tip.x-drift*.2+width*.4,base.y-rise*(1.12-blade.droop*.25),
        base.x+drift*.14+width,base.y-rise*.72,base.x+width,base.y);
      ctx.closePath();ctx.fill();
    }
  }
}

export function updateFlowerAnchor(view) {
  const point=flowerPoint(view,FLOWER.centerX,FLOWER.tieY);
  view.anchor.x=point.x;view.anchor.y=point.y;
  return view.anchor;
}

// 構圖只依視窗，鏡頭距離、氣量與最大尺寸都不改變小花大小。
export function sceneLayout(width,height) {
  const span=Math.max(100,height-(height<500?150:178)-74),baseUnit=Math.min(span,width*1.18),unit=baseUnit*1.15;
  // 共用鏡頭尺度與地板位移，讓球、花、繩及投影一起拉近而不脫節。
  const x=width/2,initialGround=height-(height<500?180:145)-(height<500?0:baseUnit*.25)+baseUnit*.15;
  const flowerHeight=unit*.30,flowerScale=flowerHeight/(FLOWER.bottom-FLOWER.top);
  const baseRopeLength=unit*(.44*825/1464+.22);
  const baseSize=unit*.195;
  // 依直立繩與最大球的實際球頂校正地面，地面最多只移到畫面底緣上方 24px。
  const tieOffset=(FLOWER.tieY-FLOWER.bottom)*flowerScale;
  const knot=Math.max(4,baseSize*.065);
  const top=initialGround+tieOffset-baseRopeLength-knot-baseSize*MAX_SCALE;
  const ground=Math.min(height-24,initialGround+Math.max(0,16-top));
  const view={width,height,x,ground,unit,flower:{angle:0},
    perspective:.5,depthScale:.52,roadSlope:0,roomHalf:roomHalfWidth(0),
    nearDepth:-.65,farDepth:.3,flowerHeight,flowerScale,baseSize,
    anchor:{x:0,y:0},baseRopeLength,ropeLength:baseRopeLength};
  updateFlowerAnchor(view);
  view.grass=createGrass();
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
  // 未爆炸時花跟隨繩子第一段；爆炸後改以零角度為目標，避免垂繩風動回饋花角。
  const first=tether.points[1],root=tether.points[0];
  const ropeTarget=exploded?0:clamp(Math.atan2(first.x-root.x,root.y-first.y)*.55,-.35,.35);
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
  const outline=[
    [
      [512,1535],[490,1535],[490,1300],[490,1050],[490,760],[420,720],[330,665],[235,570],[176,430],
      [215,280],[330,130],[512,47],[700,110],[820,250],[855,420],[810,565],
      [705,660],[610,720],[535,760],[535,1050],[535,1300],[535,1535]
    ].map(([x,y])=>{
      const p=flowerPoint(view,x,y);
      // projectShadow 要的是世界單位；這裡的 p 是旋轉後畫布像素，需先除回場景 unit。
      return {x:(p.x-view.x)/view.unit,z:0,height:(view.ground-p.y)/view.unit};
    })
  ];
  drawRoomShadow(ctx,view,outline,.65);
}

export function drawFlower(ctx,view,assets) {
  if(!assets?.flower)return;
  const s=view.flowerScale,r=Math.max(FLOWER.tieRadius*s,view.baseSize*.045);
  const tie=flowerPoint(view,FLOWER.centerX,FLOWER.tieY);
  ctx.save();ctx.translate(tie.x,tie.y);ctx.rotate(tie.angle);
  ctx.lineWidth=Math.max(1,view.baseSize*.014);
  ctx.strokeStyle='#87755a';ctx.beginPath();ctx.ellipse(0,0,r,r*.27,0,Math.PI,Math.PI*2);ctx.stroke();ctx.restore();
  const stemHeight=FLOWER.bottom-FLOWER.stemTop;
  for(let i=23;i>=0;i--) {
    const top=FLOWER.stemTop+stemHeight*i/24,bottom=FLOWER.stemTop+stemHeight*(i+1)/24;
    const sourceTop=Math.max(FLOWER.stemTop,top-.5),sourceBottom=Math.min(FLOWER.bottom,bottom+.5);
    const middle=(top+bottom)/2,p=flowerPoint(view,FLOWER.centerX,middle);
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
    ctx.drawImage(assets.flower,0,sourceTop,FLOWER.width,sourceBottom-sourceTop,
      -FLOWER.centerX*s,(sourceTop-middle)*s,FLOWER.width*s,(sourceBottom-sourceTop)*s);
    ctx.restore();
  }
  const head=flowerPoint(view,FLOWER.centerX,FLOWER.stemTop);
  ctx.save();ctx.translate(head.x,head.y);ctx.rotate(head.angle);
  ctx.drawImage(assets.flower,0,0,FLOWER.width,FLOWER.stemTop+1,
    -FLOWER.centerX*s,-FLOWER.stemTop*s,FLOWER.width*s,(FLOWER.stemTop+1)*s);
  ctx.restore();
  ctx.save();ctx.translate(tie.x,tie.y);ctx.rotate(tie.angle);
  ctx.lineWidth=Math.max(1,view.baseSize*.014);
  ctx.strokeStyle='#b4a183';ctx.beginPath();ctx.ellipse(0,0,r,r*.27,0,0,Math.PI);ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-r*.22,r*.30);ctx.lineTo(r*.20,r*.28);ctx.closePath();ctx.stroke();
  ctx.beginPath();ctx.moveTo(r*.15,r*.25);ctx.lineTo(r*.32,r*.70);ctx.stroke();ctx.restore();
}

export function drawTether(ctx,tether,view,pose) {
  ctx.strokeStyle='#776a55';ctx.lineWidth=Math.max(1,view.baseSize*.014);ctx.lineCap='round';
  ctx.beginPath();tether.points.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();
  if(!pose) return;
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);
  ctx.fillStyle='#b47c64';ctx.beginPath();ctx.moveTo(-2,-pose.height*.009);ctx.lineTo(2,-pose.height*.009);ctx.lineTo(3,pose.knot*.78);ctx.lineTo(0,pose.knot);ctx.lineTo(-3,pose.knot*.78);ctx.closePath();ctx.fill();ctx.restore();
}
