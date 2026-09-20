import { clamp } from './physics.mjs';

// 構圖只依視窗，鏡頭距離、氣量與最大尺寸都不改變消防栓大小。
export function sceneLayout(width, height) {
  const ground=Math.max(145,height-(height<500?150:178));
  const span=Math.max(100,ground-74), unit=Math.min(span, width*1.18);
  const hydrantHeight=unit*.28, x=width*.53;
  return { width,height,ground,x,hydrantHeight,baseSize:unit*.205,
    anchor:{x:x+hydrantHeight*.21,y:ground-hydrantHeight*.61}, ropeLength:unit*.30 };
}

export function createTether(view) {
  const points=Array.from({length:13},(_,i)=>{
    const t=i/12,x=view.anchor.x-view.ropeLength*.18*t+Math.sin(t*Math.PI)*view.ropeLength*.035;
    const y=view.anchor.y-view.ropeLength*.97*t;
    return {x,y,px:x,py:y};
  });
  return {points,angle:-.12,velocity:{x:0,y:0}};
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
      p.x+=vx+(wind*(pull?2:1)+(!exploded?swing.angle*920:0))*unit*step*step;
      p.y+=vy+(pull?-750:210)*unit*step*step;
    }
    // 多段繩長約束傳遞張力；爆炸只移除浮力，繩仍留在原綁點。
    for(let iteration=0;iteration<24;iteration++) {
      points[0].x=view.anchor.x; points[0].y=view.anchor.y;
      for(let i=0;i<last;i++) {
        const a=points[i],b=points[i+1],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
        const correction=(length-segment)/length,wa=i===0?0:1,wb=i+1===last&&!exploded?.24:1;
        a.x+=dx*correction*wa/(wa+wb); a.y+=dy*correction*wa/(wa+wb);
        b.x-=dx*correction*wb/(wa+wb); b.y-=dy*correction*wb/(wa+wb);
        // 路面吸收落繩，避免穿出畫面。
        if(b.y>view.ground-3) { b.y=view.ground-3; b.py=b.y; }
      }
    }
    points[0].x=points[0].px=view.anchor.x; points[0].y=points[0].py=view.anchor.y;
    const end=points[last],before=points[last-1];
    const target=clamp(Math.atan2(end.x-before.x,before.y-end.y),-.58,.58);
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

export function drawStreet(ctx,view) {
  const {width,height,ground,x,hydrantHeight:h}=view;
  const curb=ground+h*.2;
  ctx.fillStyle='rgba(157,170,162,.28)'; ctx.fillRect(0,ground-h*.42,width,height);
  ctx.fillStyle='#c5ccc7'; ctx.fillRect(0,curb,width,height-curb);
  ctx.fillStyle='#939f9a'; ctx.fillRect(0,curb,h*.03+width,h*.12);
  ctx.fillStyle='#b5bfb9'; ctx.fillRect(0,curb+h*.12,width,height-curb);
  ctx.strokeStyle='rgba(91,111,99,.17)'; ctx.lineWidth=1;
  ctx.beginPath();
  for(let i=-3;i<4;i++) {const sx=x+i*h*1.65;ctx.moveTo(sx,ground-h*.42);ctx.lineTo(sx+h*.4,curb);}
  ctx.stroke();
  ellipse(ctx,x+h*.13,ground+h*.035,h*.61,h*.13,'rgba(33,48,39,.12)');
  ellipse(ctx,x+h*.02,ground+h*.015,h*.35,h*.07,'rgba(33,48,39,.16)');
}

export function drawHydrant(ctx,view) {
  const h=view.hydrantHeight;
  ctx.save(); ctx.translate(view.x,view.ground); ctx.scale(h,h);
  const red=ctx.createLinearGradient(-.3,0,.31,0);
  red.addColorStop(0,'#8c2622');red.addColorStop(.27,'#e77a62');red.addColorStop(.48,'#c44839');red.addColorStop(1,'#71231e');
  const cap=ctx.createLinearGradient(-.24,-1.04,.22,-.7);
  cap.addColorStop(0,'#ef9277');cap.addColorStop(.45,'#c9513e');cap.addColorStop(1,'#882c25');
  // 出水管在柱體後方，前方蓋與環箍在其後繪製。
  ctx.fillStyle=red;ctx.fillRect(-.45,-.65,.88,.22);
  ellipse(ctx,-.44,-.54,.085,.145,'#74251f');ellipse(ctx,-.46,-.54,.063,.11,'#bc5343');
  ellipse(ctx,.42,-.54,.085,.145,'#6a241f');ellipse(ctx,.4,-.54,.055,.112,'#a34132');
  ctx.fillStyle=red;ctx.fillRect(-.23,-.83,.46,.74);
  ellipse(ctx,0,-.1,.31,.073,'#772720');ctx.fillStyle=red;ctx.fillRect(-.31,-.1,.62,.07);
  ellipse(ctx,0,-.03,.31,.07,'#b44938');ellipse(ctx,0,-.095,.31,.057,red);
  ctx.fillStyle=cap;ctx.beginPath();ctx.moveTo(-.25,-.8);ctx.bezierCurveTo(-.25,-1.11,.21,-1.14,.25,-.8);ctx.closePath();ctx.fill();
  ellipse(ctx,0,-.81,.28,.058,'#823329');ellipse(ctx,0,-.836,.28,.048,red);
  ctx.fillStyle='#a43d30';ctx.fillRect(-.047,-1.077,.094,.055);ellipse(ctx,0,-1.077,.047,.023,'#ef9c7e');
  ellipse(ctx,.005,-.535,.162,.163,'#732c25');ellipse(ctx,-.012,-.549,.147,.147,'#d1614b');
  ellipse(ctx,-.012,-.549,.115,.115,'#a84031');
  ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3;const x=-.012+Math.cos(a)*.055,y=-.549+Math.sin(a)*.055;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.closePath();ctx.fillStyle='#e18867';ctx.fill();
  ctx.strokeStyle='rgba(255,226,183,.35)';ctx.lineWidth=.016;ctx.beginPath();ctx.moveTo(-.14,-.37);ctx.lineTo(-.14,-.18);ctx.stroke();
  for(const bx of [-.23,.23]) ellipse(ctx,bx,-.086,.023,.013,'#f0a67f');
  // 繩圈繞住側管，後段被金屬蓋遮擋，前段銜接固定綁點。
  ctx.strokeStyle='#d9cbae';ctx.lineWidth=.014;ctx.beginPath();ctx.ellipse(.23,-.565,.038,.113,-.18,-1.7,1.6);ctx.stroke();
  ctx.restore();
}

export function drawTether(ctx,tether,view,pose) {
  ctx.strokeStyle='#776a55';ctx.lineWidth=Math.max(1,view.baseSize*.014);ctx.lineCap='round';
  ctx.beginPath();tether.points.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.stroke();
  if(!pose) return;
  ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angle);
  ctx.fillStyle='#b47c64';ctx.beginPath();ctx.moveTo(-2,-pose.height*.009);ctx.lineTo(2,-pose.height*.009);ctx.lineTo(3,pose.knot*.78);ctx.lineTo(0,pose.knot);ctx.lineTo(-3,pose.knot*.78);ctx.closePath();ctx.fill();ctx.restore();
}
