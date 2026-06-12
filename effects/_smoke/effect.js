(function () {
  "use strict";

  const shell = Shell.init({ id: "_smoke" });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const pointer = { x: 0, y: 0, active: false };
  const state = {
    radius: 64,
    color: "#6fd6c9"
  };

  canvas.className = "smoke-canvas";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  shell.container.append(canvas);

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    clear();
    drawCircle(window.innerWidth / 2, window.innerHeight / 2);
  }

  function clear() {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const gradient = context.createLinearGradient(0, 0, window.innerWidth, window.innerHeight);
    gradient.addColorStop(0, "#11151b");
    gradient.addColorStop(1, "#1d2527");
    context.fillStyle = gradient;
    context.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function drawCircle(x, y) {
    context.beginPath();
    context.arc(x, y, state.radius, 0, Math.PI * 2);
    context.fillStyle = state.color;
    context.shadowColor = state.color;
    context.shadowBlur = 28;
    context.fill();
    context.shadowBlur = 0;
  }

  function redraw() {
    clear();
    const x = pointer.active ? pointer.x : window.innerWidth / 2;
    const y = pointer.active ? pointer.y : window.innerHeight / 2;
    drawCircle(x, y);
  }

  canvas.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    redraw();
  });

  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
    redraw();
  });

  shell.addParam({
    type: "range",
    key: "radius",
    label: "圓半徑",
    min: 16,
    max: 180,
    step: 1,
    value: state.radius,
    onChange(value) {
      state.radius = value;
      redraw();
    }
  });

  shell.addParam({
    type: "color",
    key: "color",
    label: "圓色",
    value: state.color,
    onChange(value) {
      state.color = value;
      redraw();
    }
  });

  shell.addButton({
    label: "清空",
    onClick() {
      clear();
    }
  });

  window.addEventListener("resize", resize);
  resize();
})();
