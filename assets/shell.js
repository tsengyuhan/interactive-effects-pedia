/*
Shell API 用法

每個效果頁使用 classic script 載入：
  <script src="../effects.js"></script>
  <script src="../../assets/shell.js"></script>
  <script src="effect.js"></script>

效果程式固定呼叫：
  const shell = Shell.init({ id: "效果 id，需存在於 window.EFFECTS" });

可用屬性與方法：
  shell.container
    滿版效果容器。效果自行在裡面建立 canvas、video 或其他畫面元素。

  shell.addParam({
    type: "range",
    key: "size",
    label: "筆刷大小",
    min: 4,
    max: 80,
    step: 1,
    value: 24,
    onChange: (value) => {}
  });

  shell.addParam({
    type: "color",
    key: "ink",
    label: "筆墨顏色",
    value: "#1a1a1a",
    onChange: (value) => {}
  });

  shell.addParam({
    type: "select",
    key: "mode",
    label: "框內特效",
    value: "invert",
    options: [
      { value: "invert", label: "負片" },
      { value: "mosaic", label: "馬賽克" }
    ],
    onChange: (value) => {}
  });

  shell.addButton({ label: "清空畫布", onClick: () => {} });
    按鈕固定顯示在右上角，適合清空、重置等明確指令。

  shell.showError("請允許攝影機權限後重新整理頁面");
    顯示半透明錯誤蓋版與「重新整理」按鈕。
*/
(function () {
  "use strict";

  const APP_TITLE = "Interactia 網頁互動圖鑑";
  // 效果原始碼在 GitHub 的資料夾位置；資訊面板據此產生「在 GitHub 查看原始碼」連結
  const REPO_EFFECTS_BASE = "https://github.com/tsengyuhan/interactive-effects-pedia/tree/master/effects";

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (typeof text === "string") {
      element.textContent = text;
    }
    return element;
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function setChildren(parent, children) {
    for (const child of children) {
      if (child) {
        parent.append(child);
      }
    }
  }

  function createList(title, items) {
    const section = createElement("section", "shell-info-section");
    const heading = createElement("h3", "", title);
    const list = createElement("ul", "shell-list");
    for (const item of items) {
      list.append(createElement("li", "", item));
    }
    setChildren(section, [heading, list]);
    return section;
  }

  function createWhySection(effect) {
    const why = typeof effect.why === "string" ? effect.why.trim() : "";
    const references = normalizeList(effect.references);
    if (!why && references.length === 0) {
      return null;
    }

    const section = createElement("section", "shell-info-section");
    const heading = createElement("h3", "shell-small-heading", "為什麼做這個？");
    const text = why ? createElement("p", "shell-why", why) : null;
    const list = references.length > 0 ? createElement("ul", "shell-ref-list") : null;

    for (const ref of references) {
      const item = createElement("li");
      const link = createElement("a", "", ref.label || ref.url);
      link.href = ref.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
      list.append(item);
    }

    setChildren(section, [heading, text, list]);
    return section;
  }

  function createBadge(effect) {
    const badge = createElement("span", "shell-offline-badge");
    badge.textContent = effect.offline ? "完全離線" : "需網路";
    if (!effect.offline && effect.offlineNote) {
      badge.title = effect.offlineNote;
    }
    return badge;
  }

  function createErrorOverlay(message) {
    const overlay = createElement("div", "shell-error-overlay");
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = createElement("div", "shell-error-panel");
    const title = createElement("h2", "", "發生錯誤");
    const text = createElement("p", "", message);
    const reload = createElement("button", "shell-primary-button", "重新整理");
    reload.type = "button";
    reload.addEventListener("click", () => {
      location.reload();
    });

    setChildren(panel, [title, text, reload]);
    overlay.append(panel);
    return overlay;
  }

  // 載入提示：相機/麥克風與模型初始化要等幾秒，先給提示讓使用者知道不是當掉
  function createLoadingOverlay(message) {
    const overlay = createElement("div", "shell-loading-overlay");
    overlay.setAttribute("role", "status");
    const panel = createElement("div", "shell-loading-panel");
    const spinner = createElement("div", "shell-loading-spinner");
    const text = createElement("p", "shell-loading-text", message || "載入中…");
    setChildren(panel, [spinner, text]);
    overlay.append(panel);
    return overlay;
  }

  function createShell(effect) {
    document.title = `${effect.title}｜${APP_TITLE}`;
    document.body.classList.add("shell-page");

    const container = createElement("div", "shell-container");
    const back = createElement("a", "shell-back", "← 返回");
    back.href = "../../index.html";

    const actions = createElement("div", "shell-actions");
    const infoButton = createElement("button", "shell-icon-button", "ⓘ");
    infoButton.type = "button";
    infoButton.setAttribute("aria-label", "開啟資訊面板");
    infoButton.setAttribute("aria-expanded", "false");
    actions.append(infoButton);

    const toast = createElement("div", "shell-toast", effect.instructions || "");
    toast.setAttribute("role", "status");

    const drawer = createElement("aside", "shell-info-panel");
    drawer.setAttribute("aria-label", "效果資訊");
    drawer.setAttribute("aria-hidden", "true");

    const paramsSection = createElement("section", "shell-param-section");
    const paramsTitle = createElement("h3", "", "可調參數");
    const paramsMount = createElement("div", "shell-param-list");
    setChildren(paramsSection, [paramsTitle, paramsMount]);
    if (!effect.hasParams) {
      paramsSection.hidden = true;
    }

    const header = createElement("div", "shell-info-header");
    const title = createElement("h2", "", effect.title);
    const close = createElement("button", "shell-close-button", "×");
    close.type = "button";
    close.setAttribute("aria-label", "關閉資訊面板");
    setChildren(header, [title, close]);

    const description = createElement("p", "shell-description", effect.description || "");
    const whySection = createWhySection(effect);
    const instructions = createElement("p", "shell-instructions", effect.instructions || "");

    const tech = createElement("div", "shell-tech-list");
    for (const item of normalizeList(effect.tech)) {
      tech.append(createElement("span", "shell-tech", item));
    }

    const principle = createList("原理", normalizeList(effect.principle));
    const requirements = createList("需求", normalizeList(effect.requirements));
    const status = createElement("div", "shell-status-row");
    status.append(createBadge(effect));

    const source = createElement("a", "shell-source-link", "在 GitHub 查看原始碼");
    source.href = `${REPO_EFFECTS_BASE}/${effect.id}`;
    source.target = "_blank";
    source.rel = "noopener noreferrer";

    setChildren(drawer, [
      paramsSection,
      header,
      description,
      whySection,
      createElement("h3", "shell-small-heading", "操作說明"),
      instructions,
      tech,
      principle,
      requirements,
      status,
      source
    ].filter(Boolean));

    document.body.append(container, back, actions, toast, drawer);

    let toastTimer = window.setTimeout(() => {
      toast.classList.add("is-hidden");
    }, 6000);

    function setPanelOpen(open) {
      drawer.classList.toggle("is-open", open);
      drawer.setAttribute("aria-hidden", String(!open));
      infoButton.setAttribute("aria-expanded", String(open));
      infoButton.setAttribute("aria-label", open ? "關閉資訊面板" : "開啟資訊面板");
      if (open) {
        window.clearTimeout(toastTimer);
        toast.classList.add("is-hidden");
      }
    }

    infoButton.addEventListener("click", () => {
      setPanelOpen(!drawer.classList.contains("is-open"));
    });
    close.addEventListener("click", () => {
      setPanelOpen(false);
    });

    // 預設展開資訊面板，讓使用者一進來就看到操作說明與參數（會一併收掉吐司）
    setPanelOpen(true);

    function addParam(config) {
      const item = createElement("label", "shell-param");
      const row = createElement("span", "shell-param-row");
      const label = createElement("span", "shell-param-label", config.label || config.key || "參數");
      let valueText = null;
      let control = null;

      if (config.type === "range") {
        control = document.createElement("input");
        control.type = "range";
        control.min = config.min;
        control.max = config.max;
        control.step = config.step || 1;
        control.value = config.value;
        valueText = createElement("span", "shell-param-value", String(control.value));
        control.addEventListener("input", () => {
          valueText.textContent = control.value;
          if (typeof config.onChange === "function") {
            config.onChange(Number(control.value));
          }
        });
      } else if (config.type === "color") {
        control = document.createElement("input");
        control.type = "color";
        control.value = config.value || "#ffffff";
        control.addEventListener("input", () => {
          if (typeof config.onChange === "function") {
            config.onChange(control.value);
          }
        });
      } else if (config.type === "select") {
        control = document.createElement("select");
        for (const optionConfig of normalizeList(config.options)) {
          const option = document.createElement("option");
          option.value = optionConfig.value;
          option.textContent = optionConfig.label || optionConfig.value;
          control.append(option);
        }
        control.value = config.value;
        control.addEventListener("change", () => {
          if (typeof config.onChange === "function") {
            config.onChange(control.value);
          }
        });
      } else {
        throw new Error(`不支援的參數型別：${config.type}`);
      }

      setChildren(row, [label, valueText]);
      setChildren(item, [row, control]);
      paramsMount.append(item);

      if (typeof config.onChange === "function") {
        const initialValue = config.type === "range" ? Number(control.value) : control.value;
        config.onChange(initialValue);
      }

      return control;
    }

    function addButton(config) {
      const button = createElement("button", "shell-action-button", config.label || "執行");
      button.type = "button";
      button.addEventListener("click", () => {
        if (typeof config.onClick === "function") {
          config.onClick();
        }
      });
      actions.insertBefore(button, infoButton);
      return button;
    }

    function hideLoading() {
      const el = document.querySelector(".shell-loading-overlay");
      if (el) {
        el.remove();
      }
    }

    function showLoading(message) {
      hideLoading();
      document.body.append(createLoadingOverlay(message));
    }

    function showError(message) {
      hideLoading();
      const old = document.querySelector(".shell-error-overlay");
      if (old) {
        old.remove();
      }
      document.body.append(createErrorOverlay(message));
    }

    return {
      container,
      addParam,
      addButton,
      showError,
      showLoading,
      hideLoading
    };
  }

  window.Shell = {
    init(config) {
      const id = config && config.id;
      const effects = Array.isArray(window.EFFECTS) ? window.EFFECTS : [];
      const effect = effects.find((item) => item.id === id);
      if (!effect) {
        document.title = `錯誤｜${APP_TITLE}`;
        document.body.classList.add("shell-page");
        const container = createElement("div", "shell-container");
        document.body.append(container, createErrorOverlay(`登錄檔中找不到效果：${id}`));
        return {
          container,
          addParam() {},
          addButton() {},
          showError(message) {
            document.body.append(createErrorOverlay(message));
          },
          showLoading() {},
          hideLoading() {}
        };
      }
      return createShell(effect);
    }
  };
})();
