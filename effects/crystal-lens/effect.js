(function () {
  "use strict";

  const shell = Shell.init({ id: "crystal-lens" });
  const canvas = document.createElement("canvas");
  const video = document.createElement("video");
  const gl = canvas.getContext("webgl", { antialias: false });

  const state = {
    mode: 0, // 0 放大鏡、1 一般玻璃、2 毛玻璃
    radius: 140,
    zoom: 2,
    refract: 0.4,
    dispersion: 0.35,
    highlight: 0.55,
    blur: 14,
    width: 1,
    height: 1,
    mouse: { x: 0, y: 0 },
    lens: { x: 0, y: 0 },
    lastVideoTime: -1,
    hasVideoFrame: false,
    animationId: 0
  };

  const errorMessage = "請允許攝影機權限後重新整理頁面；若直接開檔案無法使用，請改用 start.bat 啟動";

  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  video.muted = true;
  video.playsInline = true;
  video.style.display = "none";
  shell.container.style.overflow = "hidden";
  shell.container.style.background = "#05070a";
  shell.container.style.cursor = "none";
  shell.container.append(video, canvas);

  const VERTEX_SOURCE = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

  // 整個畫面逐像素重算：鏡片外畫原始鏡頭畫面，鏡片內依模式改變取樣座標。
  const FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_video;
uniform vec2 u_res;
uniform vec2 u_videoRes;
uniform vec2 u_lens;
uniform float u_radius;
uniform float u_zoom;
uniform float u_refract;
uniform float u_dispersion;
uniform float u_highlight;
uniform float u_blur;
uniform float u_mode;

// 螢幕像素 → 鏡像後 cover-fit 的影片 UV
vec2 toUV(vec2 px) {
  float s = max(u_res.x / u_videoRes.x, u_res.y / u_videoRes.y);
  vec2 offset = (u_res - u_videoRes * s) * 0.5;
  vec2 uv = (px - offset) / (u_videoRes * s);
  return vec2(1.0 - uv.x, uv.y);
}

vec3 sampleVideo(vec2 px) {
  return texture2D(u_video, clamp(toUV(px), 0.0, 1.0)).rgb;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 d = px - u_lens;
  float r = length(d) / u_radius;

  if (r >= 1.0) {
    vec3 base = sampleVideo(px);
    // 鏡片外圈落影，做出玻璃浮在畫面上的感覺
    float shadow = smoothstep(1.18, 1.0, r) * 0.25;
    gl_FragColor = vec4(base * (1.0 - shadow), 1.0);
    return;
  }

  // 取樣縮放：鏡心依模式縮放、貼近邊緣時回到 1，鏡片邊界才不會出現接縫
  float centerScale = u_mode < 0.5 ? 1.0 / u_zoom : 1.0;
  float scale = mix(centerScale, 1.0, pow(r, 3.0));
  // 折射扭曲：邊緣把取樣往鏡心拉，模擬厚玻璃的邊緣折射
  scale -= u_refract * 0.35 * pow(r, 5.0);

  vec3 color;
  if (u_mode > 1.5) {
    // 毛玻璃：黃金角螺旋多點取樣平均，再混入一點白霧
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      float rr = sqrt((float(i) + 0.5) / 16.0);
      acc += sampleVideo(u_lens + d * scale + vec2(cos(a), sin(a)) * rr * u_blur);
    }
    color = acc / 16.0;
    color = mix(color, vec3(1.0), 0.08);
  } else {
    // 色散：RGB 用略微不同的縮放取樣，邊緣出現彩虹邊
    float ca = u_dispersion * 0.06 * r * r;
    color = vec3(
      sampleVideo(u_lens + d * (scale - ca)).r,
      sampleVideo(u_lens + d * scale).g,
      sampleVideo(u_lens + d * (scale + ca)).b
    );
  }

  // 邊緣高光：一圈細環，左上弧最亮，像光源打在玻璃上
  vec2 dir = d / max(length(d), 0.001);
  float rim = smoothstep(0.78, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float arcTL = pow(max(0.0, dot(dir, normalize(vec2(-1.0, -1.0)))), 2.0);
  float arcBR = pow(max(0.0, dot(dir, normalize(vec2(1.0, 1.0)))), 4.0);
  color += u_highlight * rim * (0.25 + 0.75 * arcTL + 0.3 * arcBR);
  // 邊緣輕微壓暗，做出鏡片厚度
  color *= 1.0 - 0.18 * smoothstep(0.85, 1.0, r);

  gl_FragColor = vec4(color, 1.0);
}
`;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
    }
    return shader;
  }

  function createProgram() {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERTEX_SOURCE));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SOURCE));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "program link failed");
    }
    return program;
  }

  let program = null;
  let uniforms = null;

  function setupGL() {
    program = createProgram();
    gl.useProgram(program);

    // 兩個三角形鋪滿整個畫面
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // 影片是非二次冪紋理，必須 CLAMP_TO_EDGE 且不用 mipmap
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    uniforms = {};
    for (const name of ["u_video", "u_res", "u_videoRes", "u_lens", "u_radius", "u_zoom", "u_refract", "u_dispersion", "u_highlight", "u_blur", "u_mode"]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(uniforms.u_video, 0);
  }

  shell.addParam({
    type: "select",
    key: "mode",
    label: "鏡片模式",
    value: "magnifier",
    options: [
      { value: "magnifier", label: "放大鏡" },
      { value: "plain", label: "一般玻璃" },
      { value: "frosted", label: "毛玻璃" }
    ],
    onChange(value) {
      state.mode = value === "magnifier" ? 0 : value === "plain" ? 1 : 2;
    }
  });

  shell.addParam({
    type: "range",
    key: "radius",
    label: "鏡片大小",
    min: 60,
    max: 280,
    step: 5,
    value: state.radius,
    onChange(value) {
      state.radius = value;
    }
  });

  shell.addParam({
    type: "range",
    key: "zoom",
    label: "放大倍率（放大鏡）",
    min: 1.2,
    max: 4,
    step: 0.1,
    value: state.zoom,
    onChange(value) {
      state.zoom = value;
    }
  });

  shell.addParam({
    type: "range",
    key: "refract",
    label: "折射扭曲",
    min: 0,
    max: 100,
    step: 1,
    value: state.refract * 100,
    onChange(value) {
      state.refract = value / 100;
    }
  });

  shell.addParam({
    type: "range",
    key: "dispersion",
    label: "邊緣色散",
    min: 0,
    max: 100,
    step: 1,
    value: state.dispersion * 100,
    onChange(value) {
      state.dispersion = value / 100;
    }
  });

  shell.addParam({
    type: "range",
    key: "highlight",
    label: "邊緣高光",
    min: 0,
    max: 100,
    step: 1,
    value: state.highlight * 100,
    onChange(value) {
      state.highlight = value / 100;
    }
  });

  shell.addParam({
    type: "range",
    key: "blur",
    label: "毛玻璃模糊",
    min: 2,
    max: 40,
    step: 1,
    value: state.blur,
    onChange(value) {
      state.blur = value;
    }
  });

  function resize() {
    state.width = Math.max(1, shell.container.clientWidth || window.innerWidth);
    state.height = Math.max(1, shell.container.clientHeight || window.innerHeight);
    canvas.width = Math.floor(state.width);
    canvas.height = Math.floor(state.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    state.mouse.x = event.clientX - rect.left;
    state.mouse.y = event.clientY - rect.top;
  }

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerMove);

  function render() {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      if (!state.hasVideoFrame) {
        state.hasVideoFrame = true;
        shell.hideLoading();
        state.lens.x = state.width / 2;
        state.lens.y = state.height / 2;
        state.mouse.x = state.lens.x;
        state.mouse.y = state.lens.y;
      }
      if (video.currentTime !== state.lastVideoTime) {
        state.lastVideoTime = video.currentTime;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      }

      // 鏡片平滑追著游標，帶一點慣性的玻璃感
      state.lens.x += (state.mouse.x - state.lens.x) * 0.18;
      state.lens.y += (state.mouse.y - state.lens.y) * 0.18;

      gl.uniform2f(uniforms.u_res, canvas.width, canvas.height);
      gl.uniform2f(uniforms.u_videoRes, video.videoWidth || 1, video.videoHeight || 1);
      gl.uniform2f(uniforms.u_lens, state.lens.x, state.lens.y);
      gl.uniform1f(uniforms.u_radius, state.radius);
      gl.uniform1f(uniforms.u_zoom, state.zoom);
      gl.uniform1f(uniforms.u_refract, state.refract);
      gl.uniform1f(uniforms.u_dispersion, state.dispersion);
      gl.uniform1f(uniforms.u_highlight, state.highlight);
      gl.uniform1f(uniforms.u_blur, state.blur);
      gl.uniform1f(uniforms.u_mode, state.mode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    state.animationId = window.requestAnimationFrame(render);
  }

  async function setupCamera() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      throw new Error("mediaDevices unavailable");
    }
    const request = navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: false
    });
    const timeout = new Promise((resolve, reject) => {
      window.setTimeout(() => {
        reject(new Error("camera permission timeout"));
      }, 20000);
    });
    // 無攝影機或 headless 環境可能讓權限請求懸置，逾時可避免使用者看到空畫面
    const stream = await Promise.race([request, timeout]);
    video.srcObject = stream;
    await video.play();
  }

  async function start() {
    try {
      if (!gl) {
        throw new Error("WebGL unavailable");
      }
      shell.showLoading("正在開啟相機，請稍候…");
      resize();
      setupGL();
      await setupCamera();
      render();
    } catch (error) {
      console.error(error);
      shell.showError(gl ? errorMessage : "此效果需要支援 WebGL 的瀏覽器，請改用 Chrome / Edge");
    }
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(state.animationId);
    const stream = video.srcObject;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
  });

  start();
})();
