const grid = document.getElementById("card-grid");
const chipsEl = document.getElementById("filter-chips");
const effects = Array.isArray(window.EFFECTS) ? window.EFFECTS : [];
const categories = ["全部", ...new Set(effects.map((e) => e.category).filter(Boolean))];
let current = "全部";
let animating = false;

/* ── 篩選 chip ────────────────────────────── */
function renderChips() {
  chipsEl.innerHTML = "";
  for (const category of categories) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = category;
    chip.classList.toggle("is-active", category === current);
    chip.setAttribute("aria-pressed", String(category === current));
    chip.addEventListener("click", () => {
      if (current === category) return;
      current = category;
      renderChips();
      applyFilter();
    });
    chipsEl.append(chip);
  }
}

/* ── 卡片 ─────────────────────────────────── */
function createCard(effect) {
  const card = document.createElement("a");
  card.className = "effect-card";
  card.href = `effects/${effect.id}/index.html`;
  card.dataset.category = effect.category || "";

  const thumb = document.createElement("div");
  thumb.className = "thumb";

  const image = document.createElement("img");
  image.src = `effects/${effect.id}/thumb.png`;
  image.alt = `${effect.title}縮圖`;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    // 圖片可能尚未製作；隱藏破圖圖示，保留卡片辨識性
    thumb.classList.add("is-missing");
    image.removeAttribute("src");
  });

  const placeholder = document.createElement("div");
  placeholder.className = "thumb-placeholder";
  placeholder.textContent = Array.from(effect.title || "?")[0] || "?";
  thumb.append(image, placeholder);

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = effect.title;

  const meta = document.createElement("p");
  meta.className = "card-meta";
  const cat = document.createElement("span");
  cat.textContent = effect.category;
  const sep = document.createElement("span");
  sep.className = "sep";
  sep.textContent = "/";
  const state = document.createElement("span");
  state.textContent = effect.offline ? "完全離線" : "需網路";
  if (!effect.offline && effect.offlineNote) {
    state.title = effect.offlineNote;
  }
  meta.append(cat, sep, state);

  body.append(title, meta);
  card.append(thumb, body);
  return card;
}

function renderCards() {
  grid.innerHTML = "";
  if (effects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "尚無效果，敬請期待";
    grid.append(empty);
    return;
  }
  // 一進首頁就把全部卡片渲染出來；篩選只切換顯示／隱藏，不重建 DOM
  for (const effect of effects) {
    grid.append(createCard(effect));
  }
}

/* ── 篩選動畫（FLIP）────────────────────────
   1) 不符合且目前可見的卡片先淡出後移出佈局
   2) 後方符合的卡片用 FLIP 平滑往前補位
   3) 之前隱藏、現在符合的卡片淡入 */
function matches(card) {
  return current === "全部" || card.dataset.category === current;
}

async function applyFilter() {
  if (animating) return; // 動畫期間忽略連點，避免位置量測打架
  animating = true;

  const cards = [...grid.querySelectorAll(".effect-card")];

  // 1) 淡出不再符合、且目前還顯示中的卡片
  const fadeOuts = [];
  for (const card of cards) {
    if (!card.hidden && !matches(card)) {
      const anim = card.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.94)" }],
        { duration: 220, easing: "ease", fill: "forwards" }
      );
      fadeOuts.push(
        anim.finished.then(() => {
          card.hidden = true;
          anim.cancel(); // 還原 inline 效果，交還給 CSS 控制
        })
      );
    }
  }
  await Promise.all(fadeOuts);

  // 2) FIRST：記錄仍可見卡片的目前位置
  const first = new Map();
  for (const card of cards) {
    if (!card.hidden) first.set(card, card.getBoundingClientRect());
  }

  // 把之前隱藏、現在符合的卡片放回佈局（先顯示才能量新位置）
  const appearing = [];
  for (const card of cards) {
    if (card.hidden && matches(card)) {
      card.hidden = false;
      appearing.push(card);
    }
  }

  // 3) LAST + 反向位移：可見卡片平滑滑到新位置，新出現的卡片淡入
  for (const card of cards) {
    if (card.hidden) continue;
    const next = card.getBoundingClientRect();
    if (appearing.includes(card)) {
      card.animate(
        [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }],
        { duration: 340, easing: "ease" }
      );
      continue;
    }
    const prev = first.get(card);
    if (!prev) continue;
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (dx || dy) {
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 420, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" }
      );
    }
  }

  animating = false;
}

renderChips();
renderCards();
