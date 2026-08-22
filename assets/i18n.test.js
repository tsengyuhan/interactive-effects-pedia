// node assets/i18n.test.js —— 驗字典查得到、查不到會原樣回傳、切 zh 不翻譯
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync(__dirname + "/i18n.js", "utf8");
const el = () => ({ style: {}, className: "", textContent: "", append() {}, addEventListener() {} });

function load(lang) {
  const ctx = {
    localStorage: { getItem: () => lang, setItem() {} },
    document: {
      createElement: el,
      head: { append() {} },
      addEventListener() {},
      documentElement: {},
      querySelectorAll: () => []
    },
    location: { reload() {} },
    window: {}
  };
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  return ctx.t;
}

const en = load("en");
assert.strictEqual(en("水墨筆觸"), "Ink Brush");
assert.strictEqual(en("拉鍊素材載入失敗，請確認專案檔案完整後重新整理。 ").slice(0, 3), "The"); // 尾端空白也要查得到
assert.strictEqual(en("沒有這句"), "沒有這句"); // 漏翻退回原文
assert.strictEqual(en(undefined), undefined);

const zh = load("zh");
assert.strictEqual(zh("水墨筆觸"), "水墨筆觸");

// effects.js 的每句中文都要翻得到——新增效果忘了補字典時在這裡爆掉
const registry = fs.readFileSync(__dirname + "/../effects/effects.js", "utf8");
const data = registry.slice(registry.indexOf("window.EFFECTS"));
const untranslated = [...new Set(
  (data.match(/"(?:[^"\\]|\\.)*"/g) || [])
    .map((s) => JSON.parse(s))
    .filter((s) => /[一-鿿]/.test(s) && en(s) === s)
)];
assert.deepStrictEqual(untranslated, [], "assets/i18n.js 缺這幾句翻譯：\n" + untranslated.join("\n"));

console.log("i18n ok");
