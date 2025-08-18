// Glass globe with refraction over the #water canvas.
// - Bounces around the viewport
// - Click inside globe → go to map.html
// - Uses WebGL to refract the underlying water canvas with RGB chromatic offset
// - Sits under poem overlays (z-index 12), above water (usually 0) and title chips (10)

(() => {
  const WATER_ID = 'water';        // your existing water canvas id
  const LINK_URL = 'map.html';     // click globe → navigate here

  // ---- DOM & layers ---------------------------------------------------------
  const water = document.getElementById(WATER_ID);
  if (!water) { console.warn('[glass-globe] #water not found'); return; }

  // overlay canvas (fixed, full-screen, pointer events only on the circle)
  const canvas = document.createElement('canvas');
  canvas.id = 'glass-globe';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    zIndex: 12,         // below poem-layer (15), above title chips (10)
    pointerEvents: 'auto', // we’ll gate clicks to only when inside sphere
  });
  document.body.appendChild(canvas);

  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false });
  if (!gl) { console.warn('[glass-globe] WebGL not available'); return; }

  // ---- GL utils -------------------------------------------------------------
  const vertSrc = `
    attribute vec2 aPos;
    void main() {
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;
  const fragSrc = `
    precision highp float;
    uniform vec2  uResolution;   // canvas size in device px
    uniform vec2  uCenter;       // sphere center in device px
    uniform float uRadius;       // sphere radius in device px
    uniform sampler2D uTex;      // snapshot of #water
    uniform vec2  uTexSize;      // texture size (device px)
    uniform vec2  uTexOffset;    // texture top-left in device px
    uniform float uIORr, uIORg, uIORb; // chromatic dispersion
    uniform float uThickness;    // refraction thickness scale
    uniform vec3  uLightDir;     // normalized light direction (view space)
    uniform float uFresnel;      // fresnel strength
    uniform float uAlpha;        // overall opacity
    uniform vec3  uTint;         // subtle glass tint

    // Refract utility (view vector V=(0,0,1) into sphere normal N)
    vec2 refractShift(vec3 N, float ior) {
      // Air -> glass: eta = 1.0/ior
      float eta = 1.0 / ior;
      vec3 V = vec3(0.0, 0.0, 1.0);
      // GLSL refract expects I incident *into* surface: use -V
      vec3 T = refract(-V, N, eta);
      // Project to screen plane (z=0), scale by thickness and radius
      // shift direction is T.xy / -T.z (negative because z decreases into screen)
      float z = clamp(-T.z, 1e-4, 1.0);
      return (T.xy / z) * uThickness * uRadius;
    }

    vec3 sampleGlass(vec2 frag, vec3 N) {
      // RGB sample with slightly different IORs (chromatic aberration)
      vec2 sR = frag + refractShift(N, uIORr);
      vec2 sG = frag + refractShift(N, uIORg);
      vec2 sB = frag + refractShift(N, uIORb);

      // Convert to texture UVs
      vec2 uvR = (sR - uTexOffset) / uTexSize;
      vec2 uvG = (sG - uTexOffset) / uTexSize;
      vec2 uvB = (sB - uTexOffset) / uTexSize;

      // Sample clamped to avoid bleeding
      vec3 c;
      c.r = texture2D(uTex, clamp(uvR, 0.0, 1.0)).r;
      c.g = texture2D(uTex, clamp(uvG, 0.0, 1.0)).g;
      c.b = texture2D(uTex, clamp(uvB, 0.0, 1.0)).b;

      // Slight glass tint
      c *= uTint;
      return c;
    }

    void main() {
      vec2 frag = gl_FragCoord.xy;
      // Position in sphere local space
      vec2 d = (frag - uCenter) / uRadius; // unit circle space
      float r2 = dot(d, d);
      if (r2 > 1.0) { discard; } // outside sphere

      // Hemisphere z for perfect sphere
      float z = sqrt(max(0.0, 1.0 - r2));
      vec3 N = normalize(vec3(d, z)); // surface normal

      // Base refracted color
      vec3 col = sampleGlass(frag, N);

      // Fresnel edge (schlick)
      float NdV = max(dot(N, vec3(0.0, 0.0, 1.0)), 0.0);
      float F = pow(1.0 - NdV, 5.0);
      col += vec3(F) * uFresnel;

      // Specular highlight
      vec3 L = normalize(uLightDir);
      vec3 V = vec3(0.0, 0.0, 1.0);
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 180.0);
      col += vec3(spec) * 0.25;

      // Soft rim brightening
      float rim = pow(1.0 - NdV, 2.0);
      col += vec3(rim) * 0.05;

      // Subtle inner shadow near edge
      float edge = smoothstep(0.98, 1.0, sqrt(r2));
      col *= (1.0 - edge * 0.12);

      gl_FragColor = vec4(col, uAlpha);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog)); return;
  }
  gl.useProgram(prog);

  // Fullscreen quad
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1, -1, 1,
     1,-1,  1, 1, -1, 1
  ]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Uniforms
  const U = (name) => gl.getUniformLocation(prog, name);
  const uResolution = U('uResolution');
  const uCenter     = U('uCenter');
  const uRadius     = U('uRadius');
  const uTex        = U('uTex');
  const uTexSize    = U('uTexSize');
  const uTexOffset  = U('uTexOffset');
  const uIORr       = U('uIORr');
  const uIORg       = U('uIORg');
  const uIORb       = U('uIORb');
  const uThickness  = U('uThickness');
  const uLightDir   = U('uLightDir');
  const uFresnel    = U('uFresnel');
  const uAlpha      = U('uAlpha');
  const uTint       = U('uTint');

  // Texture from #water
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Physics (CSS px)
  const S = {
    x: 180, y: 180,
    vx: 220, vy: 160,      // px/s
    r: 110,                // radius px
    alpha: 0.9,
    iorR: 1.52, iorG: 1.50, iorB: 1.48, // dispersion
    thickness: 0.85,       // refraction thickness
    tint: [1.02, 1.02, 1.02], // subtle brightening
    light: [ -0.3, 0.5, 0.8 ], // light direction
    linkArmed: false
  };

  // HiDPI, resize handling
  function fit() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(innerWidth * dpr);
    const h = Math.floor(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  fit();
  addEventListener('resize', fit);

  // Cache water rect (CSS px)
  let waterRect = water.getBoundingClientRect();
  function updateWaterRect() { waterRect = water.getBoundingClientRect(); }
  addEventListener('scroll', updateWaterRect, { passive: true });
  addEventListener('resize', updateWaterRect);

  // Click → only if inside sphere
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - S.x, dy = y - S.y;
    if (dx*dx + dy*dy <= S.r*S.r) {
      // small debounce to avoid double navigations
      if (!S.linkArmed) { S.linkArmed = true; location.href = LINK_URL; }
      setTimeout(()=> S.linkArmed = false, 600);
    }
  });

  // Make sure we don’t block poem title spawning unless in-circle
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - S.x, dy = y - S.y;
    if (dx*dx + dy*dy > S.r*S.r) {
      // Let the event pass through by disabling pointer-events briefly
      canvas.style.pointerEvents = 'none';
      setTimeout(()=> canvas.style.pointerEvents = 'auto', 0);
    }
  }, true);

  // ---- Main loop ------------------------------------------------------------
  let last = performance.now();
  let frame = 0;

  function tick(now) {
    const dt = Math.min(0.033, (now - last) / 1000); // clamp dt
    last = now;

    // Physics (CSS px)
    S.x += S.vx * dt;
    S.y += S.vy * dt;

    const W = innerWidth, H = innerHeight;
    if (S.x - S.r < 0)     { S.x = S.r;     S.vx *= -1; }
    if (S.x + S.r > W)     { S.x = W - S.r; S.vx *= -1; }
    if (S.y - S.r < 0)     { S.y = S.r;     S.vy *= -1; }
    if (S.y + S.r > H)     { S.y = H - S.r; S.vy *= -1; }

    // Update GL uniforms (device px)
    const dpr = Math.max(1, devicePixelRatio || 1);
    const cx = S.x * dpr, cy = S.y * dpr, rr = S.r * dpr;

    gl.useProgram(prog);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform2f(uCenter, cx, cy);
    gl.uniform1f(uRadius, rr);

    // Update source texture from #water every 2nd frame for perf
    if ((frame++ & 1) === 0) {
      try {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                      gl.UNSIGNED_BYTE, water);
      } catch (e) {
        // If water is WebGL without preserveDrawingBuffer, we might still be ok visually;
        // swallow errors to avoid spamming.
      }
      updateWaterRect();
    }

    const texW = Math.max(1, Math.floor(waterRect.width * dpr));
    const texH = Math.max(1, Math.floor(waterRect.height * dpr));
    const offX = Math.floor(waterRect.left * dpr);
    const offY = Math.floor(waterRect.top  * dpr);

    gl.uniform2f(uTexSize, texW, texH);
    gl.uniform2f(uTexOffset, offX, offY);

    gl.uniform1f(uIORr, S.iorR);
    gl.uniform1f(uIORg, S.iorG);
    gl.uniform1f(uIORb, S.iorB);
    gl.uniform1f(uThickness, S.thickness);
    gl.uniform3f(uLightDir, S.light[0], S.light[1], S.light[2]);
    gl.uniform1f(uFresnel, 0.45);
    gl.uniform1f(uAlpha, S.alpha);
    gl.uniform3f(uTint, S.tint[0], S.tint[1], S.tint[2]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uTex, 0);

    gl.disable(gl.BLEND);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
