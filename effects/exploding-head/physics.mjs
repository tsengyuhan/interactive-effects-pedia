export const MAX_SCALE = 2.35;
export const MAX_SWING = .32;
export const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

export function portraitBounds(width, height, head, maxScale = MAX_SCALE) {
  if (!head) return { left: 0, top: 0, right: width, bottom: height };
  const inflation = maxScale - 1;
  const radius = Math.max(head.cx - head.left, head.right - head.cx) * 1.24;
  const length = (head.bottom - head.top) * 1.05;
  const turn = Math.sin(MAX_SWING);
  // 以最大尺寸保留浮動與旋轉空間；鎖定後充氣不會連帶縮小身體。
  const reach = maxScale * (radius + length * turn) + inflation * 4;
  return {
    left: Math.min(0, head.cx - reach),
    right: Math.max(width, head.cx + reach),
    top: Math.min(0, head.bottom - maxScale * (length + radius * turn) - inflation * 9),
    bottom: Math.max(height, head.bottom + maxScale * radius * turn)
  };
}

export function fitPortrait(bounds, frameWidth, width, height) {
  const top = 72;
  // 固定預留最長狀態文字與操作區，避免提示換行造成構圖跳動。
  const bottom = height - (height < 500 ? 160 : 210);
  const spanX = bounds.right - bounds.left, spanY = bounds.bottom - bounds.top;
  const scale = Math.min(Math.max(1, width - 24) / spanX, Math.max(1, bottom - top) / spanY);
  return {
    scale,
    x: (width - spanX * scale) / 2 - (frameWidth - bounds.right) * scale,
    y: top + (bottom - top - spanY * scale) / 2 - bounds.top * scale
  };
}

export function resetState() {
  return { pressure: 0, scale: 1, velocity: 0, exploded: false };
}

export function pump(state, speed) {
  if (state.exploded || state.pressure >= 1) return;
  state.pressure = Math.min(1, state.pressure + speed / 12);
  // 累加小數時也要讓預設第十二下能確實到頂。
  if (state.pressure > 1 - 1e-8) state.pressure = 1;
  state.velocity += 0.65;
}

export function advance(state, dt, tracked, maxScale = MAX_SCALE) {
  if (state.exploded || !tracked) return false;
  const target = 1 + state.pressure * (maxScale - 1);
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const step = Math.min(dt, 0.05) / steps;
  for (let i = 0; i < steps; i++) {
    state.velocity += ((target - state.scale) * 95 - state.velocity * 13) * step;
    state.scale += state.velocity * step;
  }
  if (state.pressure >= 1 && state.scale >= maxScale * 0.985) {
    state.exploded = true;
    return true;
  }
  return false;
}

export function estimateHead(box, mask, mw, mh, width, height) {
  const { originX: x, originY: y, width: fw, height: fh } = box;
  if (![x, y, fw, fh].every(Number.isFinite) || fw <= 0 || fh <= 0) return null;
  let top = Math.max(0, y - fh * 0.65);
  const leftCol = clamp(Math.floor((x + fw * 0.15) / width * mw), 0, mw - 1);
  const rightCol = clamp(Math.ceil((x + fw * 0.85) / width * mw), leftCol + 1, mw);
  // 在臉上方尋找有足夠前景的首列，忽略少量分割雜點。
  for (let row = Math.max(0, Math.floor((y - fh * 1.35) / height * mh)); row < y / height * mh; row++) {
    let count = 0;
    for (let col = leftCol; col < rightCol; col++) if (mask[row * mw + col] > 0.6) count++;
    if (count / (rightCol - leftCol) >= 0.25) {
      top = Math.max(0, row / mh * height - fh * 0.08);
      break;
    }
  }
  let left = Math.max(0, x - fw * 0.3);
  let right = Math.min(width, x + fw * 1.3);
  // 掃描頭髮高度的左右延伸；限制範圍，避免把旁人的身體當頭髮。
  for (let row = Math.floor(top / height * mh); row < (y + fh * 0.25) / height * mh && row < mh; row++) {
    for (let col = Math.max(0, Math.floor((x - fw * 0.65) / width * mw)); col < Math.min(mw, (x + fw * 1.65) / width * mw); col++) {
      if (mask[row * mw + col] > 0.6) {
        left = Math.min(left, Math.max(0, col / mw * width - fw * 0.04));
        right = Math.max(right, Math.min(width, (col + 1) / mw * width + fw * 0.04));
      }
    }
  }
  const bottom = Math.min(height, y + fh * 1.12);
  if (right <= left || bottom <= top) return null;
  return { left, right, top, bottom, cx: (left + right) / 2, chinWidth: fw * 0.28 };
}

export function insideHead(x, y, head) {
  if (!head || y < head.top || y > head.bottom) return false;
  const ratio = (y - head.top) / (head.bottom - head.top);
  // 下緣收向下巴，讓肩膀維持原比例；上半部保留蓬鬆頭髮。
  const taper = clamp((ratio - 0.62) / 0.38, 0, 1);
  const radius = (head.right - head.left) / 2 * (1 - taper) + head.chinWidth * taper;
  return Math.abs(x - head.cx) <= radius;
}

export function splitMask(data, mw, mh, width, height, head, bodyRGBA, headRGBA) {
  for (let i = 0; i < data.length; i++) {
    const alpha = Math.round(clamp((data[i] - 0.38) / 0.42, 0, 1) * 255);
    const x=(i % mw + .5)/mw*width,y=(Math.floor(i/mw)+.5)/mh*height;
    let cut=0;
    if(head) {
      const length=head.bottom-head.top,dx=Math.abs(x-head.cx);
      const ratio=clamp((y-head.top)/length,0,1);
      const taper=clamp((ratio-.62)/.38,0,1);
      const radius=(head.right-head.left)/2*(1-taper)+head.chinWidth*taper;
      const boundary=head.bottom-length*.055+length*.08*Math.min(1,(dx/head.chinWidth)**2);
      const feather=Math.max(height/mh*1.15,length*.025);
      const edge=Math.min(radius-dx,boundary-y,y-head.top+feather);
      const amount=clamp((edge+feather*.5)/feather,0,1);
      cut=amount*amount*(3-2*amount);
    }
    const p = i * 4;
    headRGBA[p + 3] = Math.round(alpha*cut);
    bodyRGBA[p + 3] = alpha-headRGBA[p + 3];
  }
}

export function resetSwing() { return { angle:0,velocity:0,previousX:null,previousTime:0 }; }

export function trackSwing(swing, x, now, frameWidth) {
  const dt=(now-swing.previousTime)/1000;
  if(swing.previousX!==null && dt>0 && dt<.2) {
    const displacement=(x-swing.previousX)/frameWidth;
    // 真正的追蹤位移施加角衝量；瞬間重定位不當成甩頭。
    if(Math.abs(displacement)<.18) swing.velocity-=displacement*12;
    else { swing.angle=0; swing.velocity=0; }
  }
  swing.previousX=x; swing.previousTime=now;
}

export function advanceSwing(swing, dt) {
  const steps=Math.max(1,Math.ceil(dt*120)),step=dt/steps;
  for(let i=0;i<steps;i++) {
    swing.velocity+=(-swing.angle*24-swing.velocity*3.8)*step;
    swing.angle+=swing.velocity*step;
    if(Math.abs(swing.angle)>MAX_SWING) {
      swing.angle=clamp(swing.angle,-MAX_SWING,MAX_SWING); swing.velocity*=.25;
    }
  }
}

export function balloonPose(head, state, now, view, swing = { angle:0 }) {
  const squash = clamp(state.velocity * .022, -.035, .055);
  const sourceWidth = head.right-head.left, sourceHeight = head.bottom-head.top;
  const width = sourceWidth * state.scale * (1 + state.pressure*.16) * (1+squash);
  const height = sourceHeight * state.scale * (1-squash*.7);
  return {
    x: head.cx,
    y: head.bottom,
    angle: swing.angle,
    width, height, view, anchorX: head.cx, anchorY: head.bottom+sourceHeight*.06
  };
}

export function polygonArea(points) {
  return Math.abs(points.reduce((sum,p,i) => {
    const q=points[(i+1)%points.length]; return sum+p.x*q.y-q.x*p.y;
  },0))*.5;
}

export function fractureBalloon(count=32, random=Math.random) {
  const seeds=[];
  // 無格線的極座標分布；拒絕過近種子，避免退化的細長碎屑。
  for(let attempt=0;seeds.length<count && attempt<count*200;attempt++) {
    const angle=random()*Math.PI*2, radius=Math.sqrt(random())*.98;
    const point={x:Math.cos(angle)*radius,y:Math.sin(angle)*radius};
    if(seeds.every(other => Math.hypot(other.x-point.x,other.y-point.y)>.13)) seeds.push(point);
  }
  const outline=Array.from({length:96},(_,i) => ({x:Math.cos(i*Math.PI/48),y:Math.sin(i*Math.PI/48)}));
  return seeds.map(seed => {
    let polygon=outline;
    for(const other of seeds) {
      if(other===seed) continue;
      const nx=other.x-seed.x,ny=other.y-seed.y;
      const limit=(other.x*other.x+other.y*other.y-seed.x*seed.x-seed.y*seed.y)*.5;
      const clipped=[];
      for(let i=0;i<polygon.length;i++) {
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const da=a.x*nx+a.y*ny-limit,db=b.x*nx+b.y*ny-limit;
        if(da<=1e-9) clipped.push(a);
        if((da<0)!==(db<0)) { const t=da/(da-db); clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}); }
      }
      polygon=clipped;
    }
    let twiceArea=0,cx=0,cy=0;
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=a.x*b.y-b.x*a.y;
      twiceArea+=cross; cx+=(a.x+b.x)*cross; cy+=(a.y+b.y)*cross;
    }
    return { polygon, area:Math.abs(twiceArea)*.5, center:{x:cx/(3*twiceArea),y:cy/(3*twiceArea)} };
  });
}

export function advanceShard(piece, dt) {
  const steps=Math.max(1,Math.ceil(dt*120)), step=dt/steps;
  for(let i=0;i<steps;i++) {
    piece.age+=step;
    piece.flip+=piece.flipSpeed*step; piece.tilt+=piece.tiltSpeed*step;
    piece.angle+=piece.spin*step;
    const face=Math.abs(Math.cos(piece.flip)*Math.cos(piece.tilt));
    // 面積/質量比加上朝向控制阻力；迎風時攤平慢落，側立時加速。
    const drag=(.55+face*2.8)*piece.drag;
    const flutter=Math.sin(piece.age*4.3+piece.phase)*face*48;
    piece.vx+=(flutter-piece.vx*drag)*step;
    piece.vy+=(260-piece.vy*drag)*step;
    piece.x+=piece.vx*step; piece.y+=piece.vy*step;
    piece.spin*=Math.exp(-.12*step);
    piece.flipSpeed*=Math.exp(-.045*step); piece.tiltSpeed*=Math.exp(-.045*step);
  }
}
