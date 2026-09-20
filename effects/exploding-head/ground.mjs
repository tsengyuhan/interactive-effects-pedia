import { clamp } from './physics.mjs';

// x、z 為路面座標，height 為離地高度；同一透視供陰影及落片使用。
export function projectGround(view,x,z,height=0) {
  const scale=1/(1+z*view.perspective);
  return {x:view.x+x*view.unit*scale,y:view.ground+(x*view.roadSlope-z*view.depthScale-height)*view.unit*scale,scale};
}

export function unprojectAir(view,x,y,z=0) {
  const scale=1/(1+z*view.perspective);
  const gx=(x-view.x)/(view.unit*scale);
  return {x:gx,z,height:(view.ground-y)/(view.unit*scale)+gx*view.roadSlope-z*view.depthScale};
}

export function balloonShadow(view,pose) {
  const center={x:pose.x+Math.sin(pose.angle)*pose.height/2,y:pose.y-Math.cos(pose.angle)*pose.height/2};
  const world=unprojectAir(view,center.x,center.y);
  const point=projectGround(view,world.x+world.height*.32,world.height*.32);
  return {...point,rx:pose.width*.47*point.scale,ry:pose.width*.47*point.scale*view.depthScale,
    opacity:.52/(1+world.height*.45),blur:(2+world.height*5)*view.unit/350};
}

export function placeShard(view,piece,z=0) {
  const world=unprojectAir(view,piece.x,piece.y,z),scale=projectGround(view,world.x,z).scale;
  return {...piece,textureHeight:piece.height,gx:world.x,gz:z,height:world.height,
    gvx:piece.vx/(view.unit*scale),gvz:(Math.sin(piece.phase)*.32),
    vh:-piece.vy/(view.unit*scale)-Math.sin(piece.phase)*.32*view.depthScale,
    initialScale:scale,unit:view.unit,landed:false,bounces:0,settled:false};
}

export function advanceGroundShard(piece,dt,view) {
  const steps=Math.max(1,Math.ceil(dt*120)),step=dt/steps;
  for(let i=0;i<steps;i++) {
    piece.age+=step;
    if(piece.settled) continue;
    if(piece.landed) {
      const friction=Math.exp(-7*step);
      piece.gvx*=friction;piece.gvz*=friction;piece.spin*=friction;
      piece.angle+=piece.spin*step;
      if(Math.hypot(piece.gvx,piece.gvz)<.002 && Math.abs(piece.spin)<.01) {
        piece.gvx=piece.gvz=piece.spin=0;piece.settled=true;
      }
    } else {
      piece.flip+=piece.flipSpeed*step;piece.tilt+=piece.tiltSpeed*step;piece.angle+=piece.spin*step;
      const face=Math.abs(Math.cos(piece.flip)*Math.cos(piece.tilt));
      const drag=(.55+face*2.8)*piece.drag;
      piece.gvx+=(Math.sin(piece.age*4.3+piece.phase)*face*.14-piece.gvx*drag)*step;
      piece.gvz+=(Math.cos(piece.age*3.1+piece.phase)*face*.045-piece.gvz*drag)*step;
      piece.vh+=(-1.25-piece.vh*drag)*step;
      piece.height+=piece.vh*step;
      piece.spin*=Math.exp(-.12*step);piece.flipSpeed*=Math.exp(-.045*step);piece.tiltSpeed*=Math.exp(-.045*step);
      if(piece.height<=0) {
        piece.height=0;
        // 薄橡膠只小幅彈一次，接著受路面摩擦停住，不用生命週期刪除。
        if(piece.bounces===0 && piece.vh<-.25) { piece.vh=-piece.vh*.12;piece.bounces++; }
        else { piece.vh=0;piece.landed=true;piece.flip=piece.tilt=0;piece.gvx*=.4;piece.gvz*=.4; }
      }
    }
    piece.gx+=piece.gvx*step;piece.gz+=piece.gvz*step;
    const near=view.nearDepth,far=view.farDepth;
    if(piece.gz<near || piece.gz>far) {piece.gz=clamp(piece.gz,near,far);piece.gvz*=-.15;}
    const scale=projectGround(view,0,piece.gz).scale;
    const padding=Math.min(piece.width*.15,view.width*.08)/piece.unit;
    const left=(-view.x+12)/(view.unit*scale)+padding,right=(view.width-view.x-12)/(view.unit*scale)-padding;
    if(piece.gx<left || piece.gx>right) {piece.gx=clamp(piece.gx,left,right);piece.gvx*=-.15;}
  }
}

export function shardPose(view,piece) {
  const point=projectGround(view,piece.gx,piece.gz,piece.height);
  const scale=point.scale/piece.initialScale*view.unit/piece.unit;
  // 接地前逐漸平貼，避免直立薄片下半部穿過柏油。
  const airborne=clamp(piece.height/.09,0,1);
  return {...point,size:scale,airborne};
}

export function advanceWindShard(piece,dt,view,elapsed) {
  // 重置陣風要能捲起靜止薄片並越出畫面，不再套用落片的邊界反彈。
  piece.landed=false;piece.settled=false;
  const steps=Math.max(1,Math.ceil(dt*120)),step=dt/steps;
  for(let i=0;i<steps;i++) {
    piece.age+=step;
    const gust=.8+Math.min(1,elapsed/.35);
    piece.gvx+=(6*gust-piece.gvx*.5)*step;
    piece.vh+=(2.8+Math.sin(piece.phase+piece.age*8)*.8-piece.vh*2)*step;
    piece.gx+=piece.gvx*step;piece.height=Math.max(0,piece.height+piece.vh*step);
    piece.flip+=(5+Math.sin(piece.phase))*step;piece.tilt+=2*step;piece.angle+=3*step;
  }
}

export function clipRoad(ctx,view) {
  ctx.beginPath();view.road.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();
}

export function drawBalloonShadow(ctx,view,pose) {
  const shadow=balloonShadow(view,pose);
  ctx.save();clipRoad(ctx,view);ctx.filter=`blur(${shadow.blur}px)`;
  ctx.fillStyle=`rgba(25,27,30,${shadow.opacity})`;
  ctx.beginPath();ctx.ellipse(shadow.x,shadow.y,shadow.rx,shadow.ry,Math.atan(view.roadSlope),0,Math.PI*2);ctx.fill();ctx.restore();
}

export function drawShardShadow(ctx,view,piece) {
  if(piece.height>.35) return;
  const point=projectGround(view,piece.gx+piece.height*.32,piece.gz+piece.height*.32),size=point.scale/piece.initialScale*view.unit/piece.unit;
  ctx.save();clipRoad(ctx,view);ctx.translate(point.x,point.y);ctx.scale(size,size);
  ctx.transform(1,view.roadSlope,piece.gx*view.perspective*point.scale,
    (view.depthScale+view.roadSlope*piece.gx*view.perspective)*point.scale,0,0);ctx.rotate(piece.angle);
  ctx.fillStyle=`rgba(25,27,30,${.28/(1+piece.height*12)})`;
  ctx.beginPath();piece.polygon.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();ctx.restore();
}
