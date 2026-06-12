const grid = document.getElementById("card-grid");
const chips = document.getElementById("filter-chips");
const effects = Array.isArray(window.EFFECTS) ? window.EFFECTS : [];
const categories = ["全部", ...new Set(effects.map((effect) => effect.category).filter(Boolean))];
let current = "全部";

function createChip(category) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = category;
  button.setAttribute("aria-pressed", String(category === current));
  button.addEventListener("click", () => {
    current = category;
    renderChips();
    renderCards();
  });
  return button;
}

function renderChips() {
  chips.innerHTML = "";
  for (const category of categories) {
    const chip = createChip(category);
    chip.classList.toggle("is-active", category === current);
    chip.setAttribute("aria-pressed", String(category === current));
    chips.append(chip);
  }
}

function createCard(effect) {
  const card = document.createElement("a");
  card.className = "effect-card";
  card.href = `effects/${effect.id}/index.html`;

  const thumb = document.createElement("div");
  thumb.className = "thumb";

  const image = document.createElement("img");
  image.src = `effects/${effect.id}/thumb.png`;
  image.alt = `${effect.title}縮圖`;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    // 圖片可能尚未製作；隱藏破圖圖示，保留卡片辨識性。
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
  title.textContent = effect.title;

  const meta = document.createElement("div");
  meta.className = "meta-row";

  const category = document.createElement("span");
  category.className = "tag";
  category.textContent = effect.category;

  const offline = document.createElement("span");
  offline.className = "offline-badge";
  offline.textContent = effect.offline ? "🟢 完全離線" : "🔴 需網路";
  if (!effect.offline && effect.offlineNote) {
    offline.title = effect.offlineNote;
  }

  meta.append(category, offline);
  body.append(title, meta);
  card.append(thumb, body);
  return card;
}

function renderCards() {
  const list = effects.filter((effect) => current === "全部" || effect.category === current);
  grid.innerHTML = "";
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "尚無效果，敬請期待";
    grid.append(empty);
    return;
  }

  for (const effect of list) {
    grid.append(createCard(effect));
  }
}

renderChips();
renderCards();
