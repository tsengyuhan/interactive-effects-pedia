(function () {
  "use strict";

  const shell = Shell.init({ id: "sound-ripple" });
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const glCanvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const sourceCanvas = document.createElement("canvas");
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const bufferCanvas = document.createElement("canvas");
  const bufferContext = bufferCanvas.getContext("2d", { willReadFrequently: true });
  const meter = document.createElement("div");

  const errorMessage = "請允許攝影機與麥克風權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";
  const audioState = {
    context: null,
    analyser: null,
    stream: null,
    wave: null,
    sampleRate: 44100,
    db: -60,
    pitch: null,
    pitchConfidence: 0,
    lastDropTime: 0,
    wasAboveThreshold: false
  };
  const state = {
    renderMode: "2d",
    threshold: -30
  };

  const water = {
    scale: 2,
    width: 1,
    height: 1,
    previous: new Float32Array(1),
    current: new Float32Array(1),
    image: null,
    sourceImage: null,
    damping: 0.985
  };

  const display = {
    width: 1,
    height: 1,
    animationId: 0
  };
  let renderModeControl = null;

  const glState = {
    gl: null,
    program: null,
    positionBuffer: null,
    cameraTexture: null,
    heightTexture: null,
    heightPixels: null,
    locations: null,
    available: false,
    warned: false
  };

  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";

  glCanvas.style.position = "absolute";
  glCanvas.style.inset = "0";
  glCanvas.style.width = "100%";
  glCanvas.style.height = "100%";
  glCanvas.style.display = "none";

  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.display = "none";

  meter.style.position = "absolute";
  meter.style.left = "18px";
  meter.style.top = "70px";
  meter.style.zIndex = "2";
  meter.style.width = "min(260px, calc(100vw - 36px))";
  meter.style.border = "1px solid rgba(255, 255, 255, 0.16)";
  meter.style.borderRadius = "8px";
  meter.style.padding = "12px";
  meter.style.background = "rgba(3, 12, 15, 0.68)";
  meter.style.color = "#eef8f2";
  meter.style.font = "14px/1.45 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
  meter.style.backdropFilter = "blur(14px)";

  shell.container.style.background = "#0d3b46";
  shell.container.append(video, canvas, glCanvas, meter);
  context.imageSmoothingEnabled = true;

  renderModeControl = shell.addParam({
    type: "select",
    key: "renderMode",
    label: "渲染模式",
    value: state.renderMode,
    options: [
      { value: "2d", label: "2D Canvas" },
      { value: "webgl", label: "WebGL" }
    ],
    onChange(value) {
      switchRenderMode(value);
    }
  });

  shell.addParam({
    type: "range",
    key: "threshold",
    label: "觸發音量",
    min: -50,
    max: -10,
    step: 1,
    value: state.threshold,
    onChange(value) {
      state.threshold = value;
    }
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalize(value, min, max) {
    return clamp((value - min) / (max - min), 0, 1);
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function warnWebGL(message, error) {
    if (!glState.warned) {
      console.warn(message, error || "");
      glState.warned = true;
    }
  }

  function setCanvasVisibility() {
    const useWebGL = state.renderMode === "webgl" && glState.available;
    canvas.style.display = useWebGL ? "none" : "block";
    glCanvas.style.display = useWebGL ? "block" : "none";
  }

  function switchRenderMode(value) {
    if (value === "webgl") {
      if (!ensureWebGL()) {
        state.renderMode = "2d";
        if (renderModeControl) {
          renderModeControl.value = "2d";
        }
        setCanvasVisibility();
        return;
      }
      state.renderMode = "webgl";
    } else {
      state.renderMode = "2d";
    }
    setCanvasVisibility();
  }

  function resize() {
    display.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    display.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    canvas.width = Math.floor(display.width);
    canvas.height = Math.floor(display.height);
    glCanvas.width = Math.floor(display.width);
    glCanvas.height = Math.floor(display.height);
    context.imageSmoothingEnabled = true;

    water.width = Math.max(2, Math.floor(display.width / water.scale));
    water.height = Math.max(2, Math.floor(display.height / water.scale));
    water.previous = new Float32Array(water.width * water.height);
    water.current = new Float32Array(water.width * water.height);
    sourceCanvas.width = water.width;
    sourceCanvas.height = water.height;
    bufferCanvas.width = water.width;
    bufferCanvas.height = water.height;
    water.image = bufferContext.createImageData(water.width, water.height);
    resizeWebGLResources();
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "shader compile failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      varying vec2 v_uv;

      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision highp float;

      uniform sampler2D u_camera;
      uniform sampler2D u_height;
      uniform vec2 u_texel;
      varying vec2 v_uv;

      float heightAt(vec2 uv) {
        vec2 fieldUv = vec2(uv.x, 1.0 - uv.y);
        return texture2D(u_height, clamp(fieldUv, vec2(0.0), vec2(1.0))).r;
      }

      void main() {
        float gx = heightAt(v_uv + vec2(u_texel.x, 0.0)) - heightAt(v_uv - vec2(u_texel.x, 0.0));
        float gy = heightAt(v_uv - vec2(0.0, u_texel.y)) - heightAt(v_uv + vec2(0.0, u_texel.y));
        vec2 offset = clamp(vec2(gx, -gy) * 0.035, vec2(-14.0), vec2(14.0)) * u_texel;
        vec4 source = texture2D(u_camera, clamp(v_uv + offset, vec2(0.0), vec2(1.0)));
        float gradientStrength = clamp(abs(gx) * 0.012 + abs(gy) * 0.012, 0.0, 1.0);
        float shade = clamp(gy * 0.018 - gx * 0.01, -0.18, 0.34);
        float highlight = gradientStrength * 54.0 / 255.0;
        vec3 color = vec3(
          source.r * 0.82 + 18.0 / 255.0 + shade * 70.0 / 255.0 + highlight,
          source.g * 0.88 + 34.0 / 255.0 + shade * 88.0 / 255.0 + highlight,
          source.b * 0.94 + 42.0 / 255.0 + shade * 98.0 / 255.0 + highlight * 1.15
        );
        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "program link failed";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createTexture(gl) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function ensureWebGL() {
    if (glState.available) {
      return true;
    }

    try {
      const gl = glCanvas.getContext("webgl") || glCanvas.getContext("experimental-webgl");
      if (!gl) {
        throw new Error("WebGL context unavailable");
      }
      if (!gl.getExtension("OES_texture_float")) {
        throw new Error("OES_texture_float unavailable");
      }

      const program = createProgram(gl);
      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
      ]), gl.STATIC_DRAW);

      glState.gl = gl;
      glState.program = program;
      glState.positionBuffer = positionBuffer;
      glState.cameraTexture = createTexture(gl);
      glState.heightTexture = createTexture(gl);
      glState.locations = {
        position: gl.getAttribLocation(program, "a_position"),
        camera: gl.getUniformLocation(program, "u_camera"),
        height: gl.getUniformLocation(program, "u_height"),
        texel: gl.getUniformLocation(program, "u_texel")
      };
      glState.available = true;
      resizeWebGLResources();
      return true;
    } catch (error) {
      releaseWebGLResources();
      warnWebGL("WebGL 渲染模式初始化失敗，已回退 2D Canvas。", error);
      return false;
    }
  }

  function resizeWebGLResources() {
    if (!glState.available || !glState.gl) {
      return;
    }
    const gl = glState.gl;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    glState.heightPixels = new Float32Array(water.width * water.height * 4);

    // 高度場使用 float texture，避免 CPU 端打包失真，讓 WebGL 與 2D 共用同一份水波資料。
    gl.bindTexture(gl.TEXTURE_2D, glState.heightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, water.width, water.height, 0, gl.RGBA, gl.FLOAT, glState.heightPixels);

    gl.bindTexture(gl.TEXTURE_2D, glState.cameraTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, water.width, water.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  function releaseWebGLResources() {
    const gl = glState.gl;
    if (gl) {
      if (glState.cameraTexture) {
        gl.deleteTexture(glState.cameraTexture);
      }
      if (glState.heightTexture) {
        gl.deleteTexture(glState.heightTexture);
      }
      if (glState.positionBuffer) {
        gl.deleteBuffer(glState.positionBuffer);
      }
      if (glState.program) {
        gl.deleteProgram(glState.program);
      }
    }
    glState.gl = null;
    glState.program = null;
    glState.positionBuffer = null;
    glState.cameraTexture = null;
    glState.heightTexture = null;
    glState.heightPixels = null;
    glState.locations = null;
    glState.available = false;
  }

  function gaussian() {
    let u = 0;
    let v = 0;
    while (u === 0) {
      u = Math.random();
    }
    while (v === 0) {
      v = Math.random();
    }
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function addDrop(x, y, radius, depth) {
    const minX = Math.max(1, Math.floor(x - radius));
    const maxX = Math.min(water.width - 2, Math.ceil(x + radius));
    const minY = Math.max(1, Math.floor(y - radius));
    const maxY = Math.min(water.height - 2, Math.ceil(y + radius));
    for (let yy = minY; yy <= maxY; yy += 1) {
      for (let xx = minX; xx <= maxX; xx += 1) {
        const dx = xx - x;
        const dy = yy - y;
        const distance = Math.hypot(dx, dy);
        if (distance <= radius) {
          const falloff = Math.cos(distance / radius * Math.PI) * 0.5 + 0.5;
          water.previous[yy * water.width + xx] -= depth * falloff;
        }
      }
    }
  }

  function maybeDrop(now) {
    const aboveThreshold = audioState.db > state.threshold;
    const isRisingEdge = aboveThreshold && !audioState.wasAboveThreshold;
    audioState.wasAboveThreshold = aboveThreshold;
    if (!isRisingEdge || now - audioState.lastDropTime < 120) {
      return;
    }
    const power = normalize(audioState.db, state.threshold, 0);
    const x = clamp(water.width * (0.5 + gaussian() * 0.18), 2, water.width - 3);
    const pitchAmount = audioState.pitch ? normalize(audioState.pitch, 60, 1200) : 0.5;
    const targetY = lerp(water.height * 0.78, water.height * 0.22, pitchAmount);
    const y = clamp(targetY + gaussian() * water.height * 0.04, 2, water.height - 3);
    addDrop(x, y, lerp(4, 22, power), lerp(130, 680, power));
    audioState.lastDropTime = now;
  }

  function updateDamping() {
    if (!audioState.pitch) {
      water.damping = 0.985;
      return;
    }
    const amount = normalize(audioState.pitch, 60, 1200);
    // 規格允許方向對調；這裡採低音餘波長、高音短促的直覺映射。
    water.damping = lerp(0.995, 0.96, amount);
  }

  function simulateWater() {
    const w = water.width;
    const h = water.height;
    const previous = water.previous;
    const current = water.current;
    const damping = water.damping;

    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        let v = (previous[i - 1] + previous[i + 1] + previous[i - w] + previous[i + w]) / 2 - current[i];
        current[i] = v * damping;
      }
    }

    // 邊界保留鄰近高度，讓波碰邊時反射回場內而不是直接消失。
    for (let x = 1; x < w - 1; x += 1) {
      current[x] = current[w + x] * 0.92;
      current[(h - 1) * w + x] = current[(h - 2) * w + x] * 0.92;
    }
    for (let y = 1; y < h - 1; y += 1) {
      current[y * w] = current[y * w + 1] * 0.92;
      current[y * w + w - 1] = current[y * w + w - 2] * 0.92;
    }

    water.previous = current;
    water.current = previous;
  }

  function drawCameraFrame() {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      sourceContext.save();
      sourceContext.setTransform(-1, 0, 0, 1, water.width, 0);
      sourceContext.drawImage(video, 0, 0, water.width, water.height);
      sourceContext.restore();
    } else {
      const gradient = sourceContext.createLinearGradient(0, 0, water.width, water.height);
      gradient.addColorStop(0, "#174d59");
      gradient.addColorStop(1, "#0a1f28");
      sourceContext.fillStyle = gradient;
      sourceContext.fillRect(0, 0, water.width, water.height);
    }
    water.sourceImage = sourceContext.getImageData(0, 0, water.width, water.height);
  }

  function renderWater2D() {
    const w = water.width;
    const h = water.height;
    const field = water.previous;
    drawCameraFrame();
    const source = water.sourceImage.data;
    const data = water.image.data;

    for (let y = 0; y < h; y += 1) {
      const ym = clamp(y - 1, 0, h - 1);
      const yp = clamp(y + 1, 0, h - 1);
      for (let x = 0; x < w; x += 1) {
        const xm = clamp(x - 1, 0, w - 1);
        const xp = clamp(x + 1, 0, w - 1);
        const i = y * w + x;
        const gx = field[y * w + xp] - field[y * w + xm];
        const gy = field[yp * w + x] - field[ym * w + x];
        const offsetX = Math.round(clamp(gx * 0.035, -14, 14));
        const offsetY = Math.round(clamp(gy * 0.035, -14, 14));
        const sampleX = clamp(x + offsetX, 0, w - 1);
        const sampleY = clamp(y + offsetY, 0, h - 1);
        const sourceIndex = (sampleY * w + sampleX) * 4;
        const gradientStrength = clamp(Math.abs(gx) * 0.012 + Math.abs(gy) * 0.012, 0, 1);
        const shade = clamp(gy * 0.018 - gx * 0.01, -0.18, 0.34);
        const highlight = gradientStrength * 54;
        const p = i * 4;
        data[p] = clamp(source[sourceIndex] * 0.82 + 18 + shade * 70 + highlight, 0, 255);
        data[p + 1] = clamp(source[sourceIndex + 1] * 0.88 + 34 + shade * 88 + highlight, 0, 255);
        data[p + 2] = clamp(source[sourceIndex + 2] * 0.94 + 42 + shade * 98 + highlight * 1.15, 0, 255);
        data[p + 3] = 255;
      }
    }

    bufferContext.putImageData(water.image, 0, 0);
    context.clearRect(0, 0, display.width, display.height);
    context.drawImage(bufferCanvas, 0, 0, display.width, display.height);
  }

  function uploadHeightTexture() {
    const pixels = glState.heightPixels;
    const field = water.previous;
    for (let i = 0; i < field.length; i += 1) {
      pixels[i * 4] = field[i];
      pixels[i * 4 + 1] = 0;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 1;
    }
  }

  function renderWaterGL() {
    if (!ensureWebGL()) {
      state.renderMode = "2d";
      setCanvasVisibility();
      renderWater2D();
      return;
    }

    drawCameraFrame();
    uploadHeightTexture();

    const gl = glState.gl;
    const locations = glState.locations;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(glState.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, glState.positionBuffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);

    // Canvas 來源需翻轉 Y，讓 WebGL 取樣座標與 2D 版同向，避免切換時畫面上下顛倒。
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glState.cameraTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.uniform1i(locations.camera, 0);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glState.heightTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, water.width, water.height, 0, gl.RGBA, gl.FLOAT, glState.heightPixels);
    gl.uniform1i(locations.height, 1);
    gl.uniform2f(locations.texel, 1 / water.width, 1 / water.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function computeVolume(wave) {
    let sum = 0;
    for (let i = 0; i < wave.length; i += 1) {
      sum += wave[i] * wave[i];
    }
    const rms = Math.sqrt(sum / wave.length);
    return clamp(20 * Math.log10(Math.max(rms, 0.000001)), -60, 0);
  }

  function detectPitch(wave, sampleRate, db) {
    if (db < -50) {
      return { pitch: null, confidence: 0 };
    }

    const minLag = Math.floor(sampleRate / 1200);
    const maxLag = Math.min(Math.floor(sampleRate / 60), wave.length - 1);
    let bestLag = 0;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let cross = 0;
      let energyA = 0;
      let energyB = 0;
      for (let i = 0; i < wave.length - lag; i += 1) {
        const a = wave[i];
        const b = wave[i + lag];
        cross += a * b;
        energyA += a * a;
        energyB += b * b;
      }
      const denominator = Math.sqrt(energyA * energyB);
      const correlation = denominator > 0 ? cross / denominator : 0;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestCorrelation < 0.9 || bestLag <= 0) {
      return { pitch: null, confidence: bestCorrelation };
    }
    return { pitch: sampleRate / bestLag, confidence: bestCorrelation };
  }

  function analyzeAudio() {
    if (!audioState.analyser || !audioState.wave) {
      return;
    }
    audioState.analyser.getFloatTimeDomainData(audioState.wave);
    audioState.db = computeVolume(audioState.wave);
    const result = detectPitch(audioState.wave, audioState.sampleRate, audioState.db);
    audioState.pitch = result.pitch;
    audioState.pitchConfidence = result.confidence;
  }

  function updateMeter() {
    const dbText = `${audioState.db.toFixed(1)} dB`;
    const pitchText = audioState.pitch ? `${Math.round(audioState.pitch)} Hz` : "—";
    const volumeAmount = normalize(audioState.db, state.threshold, 0) * 100;
    const pitchAmount = audioState.pitch ? normalize(audioState.pitch, 60, 1200) * 100 : 0;
    meter.innerHTML = [
      `<div style="display:flex;justify-content:space-between;gap:12px"><span>音量</span><strong>${dbText}</strong></div>`,
      `<div style="height:8px;margin:7px 0 12px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden"><div style="height:100%;width:${volumeAmount}%;background:#7ee3d5"></div></div>`,
      `<div style="display:flex;justify-content:space-between;gap:12px"><span>音高</span><strong>${pitchText}</strong></div>`,
      `<div style="height:8px;margin-top:7px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden"><div style="height:100%;width:${pitchAmount}%;background:#d6e77a"></div></div>`,
      `<div style="margin-top:10px;color:rgba(238,248,242,.78);font-size:12px">音量→大小，音高→高低位置</div>`
    ].join("");
  }

  function render(now) {
    analyzeAudio();
    updateDamping();
    maybeDrop(now);
    simulateWater();
    if (state.renderMode === "webgl") {
      renderWaterGL();
    } else {
      renderWater2D();
    }
    updateMeter();
    display.animationId = window.requestAnimationFrame(render);
  }

  async function resumeAudio() {
    if (audioState.context && audioState.context.state === "suspended") {
      await audioState.context.resume();
    }
  }

  async function setupMedia() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw new Error("mediaDevices unavailable");
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext unavailable");
    }

    const request = navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      }
    });
    const timeout = new Promise((resolve, reject) => {
      window.setTimeout(() => {
        reject(new Error("camera or microphone permission timeout"));
      }, 20000);
    });
    // Headless 或無裝置環境可能讓權限請求懸置，逾時可避免只剩靜態畫面。
    audioState.stream = await Promise.race([request, timeout]);
    video.srcObject = audioState.stream;
    await video.play();
    audioState.context = new AudioContextClass();
    const source = audioState.context.createMediaStreamSource(audioState.stream);
    audioState.analyser = audioState.context.createAnalyser();
    audioState.analyser.fftSize = 2048;
    audioState.analyser.smoothingTimeConstant = 0;
    source.connect(audioState.analyser);
    audioState.sampleRate = audioState.context.sampleRate;
    audioState.wave = new Float32Array(audioState.analyser.fftSize);
    // 先完成音訊管線；若瀏覽器要求手勢，事件監聽會在下一次互動時補 resume。
    resumeAudio().catch(() => {});
  }

  function bindAudioResume() {
    const handler = () => {
      resumeAudio().catch(() => {});
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", handler);
    window.addEventListener("click", handler);
  }

  async function start() {
    try {
      resize();
      updateMeter();
      bindAudioResume();
      display.animationId = window.requestAnimationFrame(render);
      await setupMedia();
    } catch (error) {
      console.error(error);
      shell.showError(errorMessage);
    }
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(display.animationId);
    if (audioState.stream) {
      for (const track of audioState.stream.getTracks()) {
        track.stop();
      }
    }
    if (audioState.context && audioState.context.state !== "closed") {
      audioState.context.close();
    }
    releaseWebGLResources();
  });

  start();
})();
