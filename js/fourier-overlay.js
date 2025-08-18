// js/fourier-overlay.js
(() => {
  // Public API
  const FourierOverlay = {
    show(photos, index) {
      ensureUI();
      state.photos = photos;
      state.index = index;
      const p = photos[index];
      // Load, analyze, and start animation
      startFor(p.url);
    }
  };
  window.FourierOverlay = FourierOverlay;

  // ---------- Internal state/UI ----------
  const state = {
    photos: null,
    index: -1,
    order: 20,
    showCircles: true,
    animId: 0,
    t: 0,           // 0..1 animation parameter
    speed: 0.25,    // cycles per second
    coeffs: null,   // Fourier coefficients (sorted by magnitude)
    pts: null,      // original outline points (complex form)
    W: 0,
    H: 0
  };

  let els = {
    lightbox: null,
    img: null,
    cap: null,
    canvas: null,
    ctx: null,
    btnToggle: null,
    slider: null,
    sliderVal: null
  };

  function ensureUI() {
    if (els.canvas) return;

    els.lightbox = document.getElementById('lightbox');
    els.img      = document.getElementById('lightbox-img');   // we’ll hide it
    els.cap      = document.getElementById('lightbox-cap');

    // Create canvas if needed
    const canvas = document.createElement('canvas');
    canvas.id = 'fourier-canvas';
    canvas.style.maxWidth = 'min(92vw, 1400px)';
    canvas.style.maxHeight = '92vh';
    canvas.style.borderRadius = '10px';
    canvas.style.boxShadow = '0 6px 18px rgba(0,0,0,.6)';
    canvas.style.background = '#000';

    // Insert just after the image
    els.img?.insertAdjacentElement('afterend', canvas);
    els.canvas = canvas;
    els.ctx = canvas.getContext('2d');

    // Controls (if not already present)
    let ctl = document.getElementById('fourier-controls');
    if (!ctl) {
      ctl = document.createElement('div');
      ctl.id = 'fourier-controls';
      ctl.style.cssText = 'margin-top:10px;display:flex;gap:12px;align-items:center;color:#e6e6e6;font:500 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;justify-content:center;';
      els.canvas.parentElement?.appendChild(ctl);

      const btn = document.createElement('button');
      btn.id = 'toggle-circles';
      btn.type = 'button';
      btn.textContent = 'Hide circles';
      btn.style.cssText = 'background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 10px;cursor:pointer;';
      ctl.appendChild(btn);

      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;';
      label.innerHTML = `Order <input id="fourier-order" type="range" min="1" max="200" value="20" /> <span id="fourier-order-val">20</span>`;
      ctl.appendChild(label);
    }

    els.btnToggle = document.getElementById('toggle-circles');
    els.slider    = document.getElementById('fourier-order');
    els.sliderVal = document.getElementById('fourier-order-val');

    // Wire controls
    els.btnToggle.onclick = () => {
      state.showCircles = !state.showCircles;
      els.btnToggle.textContent = state.showCircles ? 'Hide circles' : 'Show circles';
    };
    els.slider.oninput = () => {
      state.order = Math.max(1, Math.min(200, parseInt(els.slider.value || '20', 10)));
      els.sliderVal.textContent = String(state.order);
    };

    // Hide the raw <img> – canvas is our main view
    if (els.img) els.img.style.display = 'none';

    // Close resets animation
    const closeBtn = els.lightbox?.querySelector('.close');
    closeBtn?.addEventListener('click', stop);
  }

  function stop() {
    if (state.animId) cancelAnimationFrame(state.animId);
    state.animId = 0;
    state.coeffs = null;
    state.pts = null;
  }

  async function startFor(url) {
    stop();

    // Load image
    const img = await loadImage(url);
    // Fit canvas to viewport (keeping image aspect)
    const maxW = Math.min(window.innerWidth * 0.92, 1400);
    const maxH = Math.min(window.innerHeight * 0.92, 1400);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const W = Math.round(img.width * scale);
    const H = Math.round(img.height * scale);
    els.canvas.width = W;
    els.canvas.height = H;
    state.W = W; state.H = H;

    // Build outline points (downscale analyze → Sobel → select boundary)
    const pts = await buildOutlinePoints(img, W, H);
    if (pts.length < 8) {
      // Fallback: just draw the image if outline too small
      const ctx = els.ctx;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      return;
    }

    // Transform to complex array centered at (0,0)
    const cx = avg(pts.map(p => p.x));
    const cy = avg(pts.map(p => p.y));
    const complex = pts.map(p => ({ re: p.x - cx, im: p.y - cy }));

    // Discrete Fourier Transform
    const coeffs = dft(complex);
    // Sort by amplitude (largest first) – better visual
    coeffs.sort((a, b) => b.amp - a.amp);
    state.coeffs = coeffs;
    state.pts = complex;
    state.t = 0;

    // Animate
    animate();
  }

  function animate(ts) {
    const { ctx } = els;
    const { W, H, coeffs } = state;
    if (!coeffs) return;

    if (!animate._last) animate._last = performance.now();
    const now = performance.now();
    const dt = (now - animate._last) / 1000;
    animate._last = now;

    // Clear
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, W, H);

    // Center origin
    ctx.translate(W / 2, H / 2);

    // Advance t
    state.t = (state.t + dt * state.speed) % 1;

    // Reconstruct with N terms
    const N = Math.max(1, Math.min(state.order, coeffs.length));
    let x = 0, y = 0;

    // Draw epicycles (optional)
    if (state.showCircles) {
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1;
    }

    for (let k = 0; k < N; k++) {
      const c = coeffs[k];
      const prev = { x, y };
      // vector contribution: c.amp * e^{i(2πf t + phase)}
      const angle = 2 * Math.PI * c.freq * state.t + c.phase;
      x += c.amp * Math.cos(angle);
      y += c.amp * Math.sin(angle);

      if (state.showCircles) {
        // circle for current radius
        ctx.beginPath();
        ctx.arc(prev.x, prev.y, c.amp, 0, Math.PI * 2);
        ctx.stroke();

        // radius line
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }

    // Plot the current “pen” and trailing path
    // Build trail by sampling multiple s in [0..t]
    const TRAIL_SEG = 400; // small, smooth trail
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i <= TRAIL_SEG; i++) {
      const s = state.t - i / TRAIL_SEG * 0.5; // 50% of a revolution trail
      const sWrap = ((s % 1) + 1) % 1;
      const pt = reconstruct(coeffs, N, sWrap);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    state.animId = requestAnimationFrame(animate);
  }

  // ---------- Helpers ----------

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  async function buildOutlinePoints(img, W, H) {
    // Downscale for analysis
    const ANALYZE_W = 512;
    const scale = Math.min(ANALYZE_W / W, 1);
    const w = Math.max(32, Math.floor(W * scale));
    const h = Math.max(32, Math.floor(H * scale));

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const gx = c.getContext('2d', { willReadFrequently: true });
    gx.drawImage(img, 0, 0, w, h);

    const imgData = gx.getImageData(0, 0, w, h);
    const gray = toGrayscale(imgData.data);
    const { mag } = sobel(gray, w, h);

    // Threshold edges
    const threshold = otsu(gray); // automatic threshold helps
    const strongEdges = new Uint8ClampedArray(w * h);
    for (let i = 0; i < mag.length; i++) {
      strongEdges[i] = mag[i] > threshold * 1.5 ? 255 : 0; // a bit stricter
    }

    // Sample points along outer edge by scanning
    const pts = sampleEdgePoints(strongEdges, w, h, 900);

    // Map back to display size
    const inv = 1 / scale;
    return pts.map(p => ({ x: p.x * inv, y: p.y * inv }));
  }

  function toGrayscale(rgba) {
    const gray = new Float32Array(rgba.length / 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
      gray[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
    return gray;
  }

  function sobel(gray, w, h) {
    const mag = new Float32Array(w * h);
    const Gx = [-1,0,1,-2,0,2,-1,0,1];
    const Gy = [-1,-2,-1,0,0,0,1,2,1];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sx = 0, sy = 0, idx = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const v = gray[(y + j) * w + (x + i)];
            sx += v * Gx[idx];
            sy += v * Gy[idx];
            idx++;
          }
        }
        mag[y * w + x] = Math.hypot(sx, sy);
      }
    }
    return { mag };
  }

  function otsu(gray) {
    // quick Otsu threshold (0..255)
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) {
      const v = Math.max(0, Math.min(255, gray[i] | 0));
      hist[v]++;
    }
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];

    let sumB = 0, wB = 0, varMax = 0, threshold = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > varMax) {
        varMax = between;
        threshold = t;
      }
    }
    return threshold;
  }

  function sampleEdgePoints(edge, w, h, maxPts) {
    const pts = [];
    // simple grid step – collect edge pixels sparsely
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / maxPts)));
    for (let y = 1; y < h - 1; y += step) {
      for (let x = 1; x < w - 1; x += step) {
        if (edge[y * w + x] > 0) pts.push({ x, y });
      }
    }
    if (pts.length < 4) return pts;

    // Sort by angle around centroid to form a loop
    const cx = avg(pts.map(p => p.x));
    const cy = avg(pts.map(p => p.y));
    pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

    // Optionally decimate to maxPts
    if (pts.length > maxPts) {
      const ratio = pts.length / maxPts;
      const filtered = [];
      for (let i = 0; i < pts.length; i += ratio) filtered.push(pts[Math.floor(i)]);
      return filtered;
    }
    return pts;
  }

  function avg(arr) {
    return arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  }

  // Discrete Fourier Transform of complex points x[n]=re+im*i
  function dft(x) {
    const N = x.length;
    const out = [];
    for (let k = 0; k < N; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const phi = -2 * Math.PI * k * n / N;
        const c = Math.cos(phi), s = Math.sin(phi);
        re += x[n].re * c - x[n].im * s;
        im += x[n].re * s + x[n].im * c;
      }
      re /= N; im /= N;
      out.push({
        re, im,
        amp: Math.hypot(re, im),
        phase: Math.atan2(im, re),
        freq: k // natural order; we’ll sort by amplitude when drawing
      });
    }
    return out;
  }

  function reconstruct(coeffs, N, t) {
    let x = 0, y = 0;
    for (let k = 0; k < N; k++) {
      const c = coeffs[k];
      const a = 2 * Math.PI * c.freq * t + c.phase;
      x += c.amp * Math.cos(a);
      y += c.amp * Math.sin(a);
    }
    return { x, y };
  }
})();
