export const MAX_SCALE = 2.35;
export const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

export function portraitBounds(width, height, head) {
  if (!head) return { left: 0, top: 0, right: width, bottom: height };
  const inflation = MAX_SCALE - 1;
  const radius = Math.max(head.cx - head.left, head.right - head.cx);
  const length = head.bottom - head.top;
  const turn = Math.sin(inflation * 0.028);
  // 以最大尺寸保留浮動與旋轉空間；鎖定後充氣不會連帶縮小身體。
  const reach = MAX_SCALE * (radius + length * turn) + inflation * 4;
  return {
    left: Math.min(0, head.cx - reach),
    right: Math.max(width, head.cx + reach),
    top: Math.min(0, head.bottom - MAX_SCALE * (length + radius * turn) - inflation * 9),
    bottom: Math.max(height, head.bottom + MAX_SCALE * radius * turn)
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

export function advance(state, dt, tracked) {
  if (state.exploded || !tracked) return false;
  const target = 1 + state.pressure * (MAX_SCALE - 1);
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const step = Math.min(dt, 0.05) / steps;
  for (let i = 0; i < steps; i++) {
    state.velocity += ((target - state.scale) * 95 - state.velocity * 13) * step;
    state.scale += state.velocity * step;
  }
  if (state.pressure >= 1 && state.scale >= MAX_SCALE * 0.985) {
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
    const isHead = insideHead((i % mw + 0.5) / mw * width, (Math.floor(i / mw) + 0.5) / mh * height, head);
    const p = i * 4;
    bodyRGBA[p + 3] = isHead ? 0 : alpha;
    headRGBA[p + 3] = isHead ? alpha : 0;
  }
}
