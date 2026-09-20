import { clamp } from './physics.mjs';

export const ROOM_LIGHT={x:-.55,z:-1.3,height:2.3};
export const ROOM_BACK=.65, ROOM_FRONT=-1.4, WALL_SLOPE=.85;
export const roomHalfWidth=z=>(ROOM_BACK-z)/WALL_SLOPE;
const dot=(a,b)=>a.x*b.x+a.z*b.z+a.height*b.height;
const sub=(a,b)=>({x:a.x-b.x,z:a.z-b.z,height:a.height-b.height});
const cross=(a,b)=>({x:a.z*b.height-a.height*b.z,z:a.height*b.x-a.x*b.height,height:a.x*b.z-a.z*b.x});
const mean=points=>points.reduce((a,p)=>({x:a.x+p.x/points.length,z:a.z+p.z/points.length,height:a.height+p.height/points.length}),{x:0,z:0,height:0});

export function projectPoint(view,x,z,height=0) {
  const scale=1/(1+z*view.perspective);
  return {x:view.x+x*view.unit*scale,y:view.ground+(x*view.roadSlope-z*view.depthScale-height)*view.unit*scale,scale};
}

export function unprojectPoint(view,x,y,z=0) {
  const scale=1/(1+z*view.perspective),gx=(x-view.x)/(view.unit*scale);
  return {x:gx,z,height:(view.ground-y)/(view.unit*scale)+gx*view.roadSlope-z*view.depthScale};
}

export function roomSurfaces(view) {
  const front=ROOM_FRONT,back=ROOM_BACK,top=2.6,w=roomHalfWidth(front);
  const p=(x,z,height)=>({x,z,height});
  return [
    {id:'floor',offset:0,normal:p(0,0,1),points:[p(-w,front,0),p(w,front,0),p(0,back,0)]},
    {id:'left',offset:-back,normal:p(WALL_SLOPE,-1,0),points:[p(-w,front,0),p(0,back,0),p(0,back,top),p(-w,front,top)]},
    {id:'right',offset:-back,normal:p(-WALL_SLOPE,-1,0),points:[p(0,back,0),p(w,front,0),p(w,front,top),p(0,back,top)]}
  ];
}

export function rayHit(view,origin,direction) {
  let nearest=null;
  for(const surface of roomSurfaces(view)) {
    const denominator=dot(direction,surface.normal);if(Math.abs(denominator)<1e-9)continue;
    const t=(surface.offset-dot(origin,surface.normal))/denominator;if(t<1e-8)continue;
    const point={x:origin.x+t*direction.x,z:origin.z+t*direction.z,height:origin.height+t*direction.height};
    const center=mean(surface.points);
    if(!surface.points.every((a,i)=>{
      const edge=sub(surface.points[(i+1)%surface.points.length],a);
      const side=dot(cross(edge,sub(center,a)),surface.normal)>=0?1:-1;
      return side*dot(cross(edge,sub(point,a)),surface.normal)>=-1e-8;
    }))continue;
    if(!nearest||t<nearest.t)nearest={surface:surface.id,point,t};
  }
  return nearest;
}

function clipPolygon(points,distance) {
  const result=[];
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b);
    if(da>=-1e-9)result.push(a);
    if((da<0)!==(db<0)) {
      const t=da/(da-db);result.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,height:a.height+(b.height-a.height)*t});
    }
  }
  return result;
}

export function projectShadow(view,outline) {
  if(outline.length<3)return [];
  const center=mean(outline),light=ROOM_LIGHT,planes=[];
  for(let i=0;i<outline.length;i++) {
    const normal=cross(sub(outline[i],light),sub(outline[(i+1)%outline.length],light));
    const sign=dot(normal,sub(center,light))>=0?1:-1;
    planes.push(point=>sign*dot(normal,sub(point,light)));
  }
  const normal=cross(sub(outline[1],outline[0]),sub(outline[2],outline[0]));
  const sign=dot(normal,sub(light,center))>=0?-1:1;
  planes.push(point=>sign*dot(normal,sub(point,center)));
  // 光源在凸房內；接收面裁到同一光錐後，每條光線只落在唯一出口，接縫不重複投影。
  return roomSurfaces(view).flatMap(surface=>{
    let polygon=surface.points;
    for(const distance of planes) {polygon=clipPolygon(polygon,distance);if(polygon.length<3)return [];}
    const worldCenter=mean(polygon),distance=Math.hypot(...Object.values(sub(worldCenter,center)));
    return [{surface:surface.id,world:polygon,points:polygon.map(p=>projectPoint(view,p.x,p.z,p.height)),
      distance,opacity:.30/(1+distance*.30),blur:(.7+distance*1.4)*view.unit/350}];
  });
}

export function balloonOutline(view,pose) {
  const c=Math.cos(pose.angle),s=Math.sin(pose.angle);
  return Array.from({length:48},(_,i)=>{
    const a=i*Math.PI/24,x=Math.cos(a)*pose.width*.5,y=(Math.sin(a)-1)*pose.height*.5;
    return unprojectPoint(view,pose.x+x*c-y*s,pose.y+x*s+y*c,0);
  });
}

export function roomPalette(hex) {
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min,l=(max+min)/2;
  let h=0;if(d)h=(max===rgb[0]?(rgb[1]-rgb[2])/d+(rgb[1]<rgb[2]?6:0):max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)*60;
  const saturation=d?d/(1-Math.abs(2*l-1)):0,base=.30+l*.50;
  const color=(shift,s,light)=>({h:(h+shift+360)%360,s:saturation<.04?0:clamp(saturation*s,.12,.65),l:clamp(light,.18,.94)});
  return {left:color(0,1,base),right:color(h<55||h>330?14:-18,.5,base+.18),
    floor:{h:45,s:saturation<.04?0:clamp(saturation*.45,.1,.28),l:clamp(base+.26,.18,.94)}};
}

function trace(ctx,points) {points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();}
function path(ctx,points) {ctx.beginPath();trace(ctx,points);}

export function drawRoom(ctx,view,primary) {
  const palette=roomPalette(primary);
  for(const surface of roomSurfaces(view)) {
    const points=surface.points.map(p=>projectPoint(view,p.x,p.z,p.height)),color=palette[surface.id];
    const light=sub(ROOM_LIGHT,mean(surface.points)),length=Math.hypot(...Object.values(light));
    const diffuse=Math.max(0,dot(surface.normal,light)/(length*Math.hypot(...Object.values(surface.normal)))),level=color.l*(.81+.19*diffuse);
    const gradient=ctx.createLinearGradient(0,0,view.width,view.height);
    gradient.addColorStop(0,`hsl(${color.h} ${color.s*100}% ${Math.min(.97,level+.045)*100}%)`);
    gradient.addColorStop(1,`hsl(${color.h} ${color.s*100}% ${level*100}%)`);
    ctx.fillStyle=gradient;path(ctx,points);ctx.fill();
  }
  // 交界細暗線只表達接觸遮蔽，不冒充物件投影。
  ctx.strokeStyle='rgba(35,54,50,.12)';ctx.lineWidth=Math.max(1,view.unit*.003);
  const corner=projectPoint(view,0,ROOM_BACK,0),top=projectPoint(view,0,ROOM_BACK,2.6);
  for(const x of [-roomHalfWidth(ROOM_FRONT),roomHalfWidth(ROOM_FRONT)]) {
    const end=projectPoint(view,x,ROOM_FRONT,0);ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(corner.x,corner.y);ctx.stroke();
  }
  ctx.beginPath();ctx.moveTo(corner.x,corner.y);ctx.lineTo(top.x,top.y);ctx.stroke();
}

export function drawRoomShadow(ctx,view,outline,strength=1) {
  const outlines=Array.isArray(outline[0])?outline:[outline];
  const shadows=outlines.flatMap(polygon=>projectShadow(view,polygon));if(!shadows.length)return;
  const distance=shadows.reduce((sum,s)=>sum+s.distance/shadows.length,0);
  ctx.save();ctx.beginPath();
  for(const surface of roomSurfaces(view))trace(ctx,surface.points.map(p=>projectPoint(view,p.x,p.z,p.height)));
  ctx.clip();ctx.filter=`blur(${(.7+distance*1.4)*view.unit/350}px)`;
  ctx.fillStyle=`rgba(26,37,35,${.30/(1+distance*.30)*strength})`;
  // 牆地子多邊形合成後才柔化一次，避免共同接縫被各自模糊出亮線。
  ctx.beginPath();for(const shadow of shadows)trace(ctx,shadow.points);ctx.fill();ctx.restore();
}
