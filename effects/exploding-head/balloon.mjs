// 保留固定大小的 GPU 貼圖，避免相機推論時反覆配置資源。
export function createBalloon(document) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL unavailable');
  const shaders = [];
  function shader(type, source) {
    const value = gl.createShader(type);
    shaders.push(value); gl.shaderSource(value, source); gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
    return value;
  }
  const program = gl.createProgram();
  let buffer, texture;
  try {
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 position; varying vec2 point; void main(){ point=position; gl_Position=vec4(position,0.,1.); }'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 point;
      uniform sampler2D photo;
      uniform float pressure;
      uniform vec3 neckColor;
      uniform float neckReady;
      uniform float neckRatio;
      void main() {
        vec2 p=point/0.985;
        // 下端收成與原頸同寬的短氣口，上部仍保持飽滿球面。
        float taper=1.-smoothstep(-.98,-.70,p.y);
        p.x/=mix(1.,clamp(neckRatio/.34,.20,.8),taper);
        float radius=dot(p,p);
        if(radius>1.) { gl_FragColor=vec4(0.); return; }
        vec3 n=vec3(p,sqrt(max(0.,1.-radius)));
        // 球面經緯度讓五官隨表面包覆；中央保留足夠照片比例。
        vec2 curved=vec2(atan(n.x,max(.001,n.z))/3.14159265,asin(n.y)/3.14159265);
        vec2 uv=mix(p*.5,curved,.64)+.5;
        uv.y=1.-uv.y;
        vec3 color=texture2D(photo,uv).rgb;
        vec3 light=normalize(vec3(-.48,.66,1.));
        float diffuse=max(0.,dot(n,light));
        float rim=pow(1.-n.z,2.);
        float gloss=pow(max(0.,dot(n,normalize(light+vec3(0.,0.,1.)))),34.);
        color=mix(color,neckColor,(1.-smoothstep(-.98,-.77,p.y))*neckReady);
        // 不透明人臉包滿球面，以柔和方向光保留立體與原膚色。
        color*=.89+.18*diffuse-.035*rim;
        color+=vec3(1.,.99,.96)*gloss*(.14+.08*pressure);
        float alpha=1.-smoothstep(.990,1.,sqrt(radius));
        gl_FragColor=vec4(color,alpha);
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.LINEAR);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.uniform1i(gl.getUniformLocation(program, 'photo'), 0);
  } catch (error) {
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw error;
  }
  const input = document.createElement('canvas'); input.width = input.height = 256;
  const context = input.getContext('2d', { willReadFrequently: true });
  const pressureUniform = gl.getUniformLocation(program, 'pressure');
  const neckColorUniform=gl.getUniformLocation(program,'neckColor');
  const neckReadyUniform=gl.getUniformLocation(program,'neckReady');
  const neckRatioUniform=gl.getUniformLocation(program,'neckRatio');
  return {
    canvas,
    update(headLayer, head) {
      context.clearRect(0, 0, 256, 256);
      const crop=head.face || head;
      context.drawImage(headLayer, crop.left, crop.top, crop.right-crop.left, crop.bottom-crop.top, 0, 0, 256, 256);
      const image = context.getImageData(0, 0, 256, 256);
      fillTexture(image.data, 256, 256);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
    },
    render(pressure,neck=null,ratio=.13) {
      if (gl.isContextLost()) throw new Error('WebGL context lost');
      gl.viewport(0, 0, 512, 512); gl.useProgram(program);
      gl.uniform1f(pressureUniform, pressure);
      gl.uniform3f(neckColorUniform,...(neck || [0,0,0]).map(value=>value/255));
      gl.uniform1f(neckReadyUniform,neck?1:0); gl.uniform1f(neckRatioUniform,ratio);
      gl.drawArrays(gl.TRIANGLES,0,6);
      return canvas;
    },
    release() {
      gl.deleteTexture(texture); gl.deleteBuffer(buffer);
      shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.width = canvas.height = input.width = input.height = 1;
    }
  };
}

export function fillTexture(pixels, width, height) {
  // 每列先向外延伸有效人像，空列再取最近有效列；不把背景貼回球面。
  const originalAlpha=new Uint8Array(width*height);
  for(let i=0;i<originalAlpha.length;i++) originalAlpha[i]=pixels[i*4+3];
  const rows = [];
  for (let y = 0; y < height; y++) {
    const valid = [];
    for (let x = 0; x < width; x++) if (pixels[(y*width+x)*4+3] >= 180) valid.push(x);
    if (!valid.length) continue;
    rows.push(y);
    let next = 0;
    for (let x = 0; x < width; x++) {
      while (next+1 < valid.length && Math.abs(valid[next+1]-x) < Math.abs(valid[next]-x)) next++;
      const target=(y*width+x)*4, source=(y*width+valid[next])*4;
      if (pixels[target+3] < 180) for (let c=0;c<3;c++) pixels[target+c]=pixels[source+c];
      pixels[target+3]=255;
    }
  }
  let next=0;
  for (let y=0;y<height;y++) {
    while(next+1<rows.length && Math.abs(rows[next+1]-y)<Math.abs(rows[next]-y)) next++;
    if (rows.length && y!==rows[next]) pixels.copyWithin(y*width*4,rows[next]*width*4,(rows[next]+1)*width*4);
    if (!rows.length) for(let x=0;x<width;x++) pixels.set([172,125,94,255],(y*width+x)*4);
  }
  // 只柔化補入的側緣，消除逐列延伸的髮絲條紋；有效五官保持原解析度。
  const filled=pixels.slice(), radius=Math.max(1,Math.round(height*.055));
  for(let x=0;x<width;x++) {
    const sums=[0,0,0];
    let low=0,high=-1;
    for(let y=0;y<height;y++) {
      const nextLow=Math.max(0,y-radius),nextHigh=Math.min(height-1,y+radius);
      while(high<nextHigh) { high++; for(let c=0;c<3;c++) sums[c]+=filled[(high*width+x)*4+c]; }
      while(low<nextLow) { for(let c=0;c<3;c++) sums[c]-=filled[(low*width+x)*4+c]; low++; }
      const index=y*width+x,alpha=originalAlpha[index];
      if(alpha>=180) continue;
      const blend=1-(alpha/180)**2;
      for(let c=0;c<3;c++) pixels[index*4+c]=filled[index*4+c]*(1-blend)+sums[c]/(high-low+1)*blend;
    }
  }
  // 先補有效前景RGB；實心球面模式不讓原遮罩孔洞透出合成背景。
  for(let i=0;i<originalAlpha.length;i++) pixels[i*4+3]=255;
}
