// js/fourier-outline.js
(() => {
  // UI references
  const lightbox   = document.getElementById("lightbox");
  const imgEl      = document.getElementById("lightbox-img");
  const canvas     = document.getElementById("fourier-canvas");
  const ctx        = canvas.getContext("2d");

  const btnOutline = document.getElementById("btn-outline-toggle");
  const btnCircles = document.getElementById("btn-circles-toggle");
  const btnOrder   = document.getElementById("btn-order");

  // State
  let enabled = false;
  let showCircles = false;
  let order = 20;
  let rafId = 0;

  // Contours and coefficients
  let contoursPx = [];      // array of arrays of {x,y} in canvas px coords (top N)
  let mainCoeffs = null;    // DFT coeffs for largest contour
  let t = 0;                // phase for epicycles animation
  const MAX_CONTOURS = 6;   // limit for drawing, for perf

  // Lazy load OpenCV.js only when first needed
  let cvReadyPromise = null;
  function ensureOpenCV() {
    if (cvReadyPromise) return cvReadyPromise;
    cvReadyPromise = new Promise((resolve, reject) => {
      if (window.cv && window.cv.Mat) return resolve();
      const s = document.createElement('script');
      s.src = "https://docs.opencv.org/4.x/opencv.js";
      s.async = true;
      s.onload = () => {
        // opencv.js sets Module.onRuntimeInitialized
        const check = () => {
          if (window.cv && cv && cv.Mat) resolve();
          else setTimeout(check, 50);
        };
        check();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return cvReadyPromise;
  }

  // Button handlers
  if (btnOutline) {
    btnOutline.addEventListener("click", async () => {
      enabled = !enabled;
      btnOutline.textContent = enabled ? "Outline ✓" : "Outline";
      if (enabled && lightbox?.classList.contains("open") && imgEl?.src) {
        await analyzeCurrentImage();
        startLoop();
      } else {
        stopLoop(true);
      }
    });
  }
  if (btnCircles) {
    btnCircles.addEventListener("click", () => {
      showCircles = !showCircles;
      btnCircles.textContent = showCircles ? "Circles ✓" : "Circles";
    });
  }
  if (btnOrder) {
    btnOrder.addEventListener("click", async () => {
      const val = prompt("Set Fourier order (5–200):", String(order));
      const n = parseInt(val, 10);
      if (Number.isFinite(n) && n >= 5 && n <= 200) {
        order = n;
        btnOrder.textContent = `Order: ${order}`;
        if (enabled && contoursPx.length) {
          await computeMainCoeffs(); // recompute
        }
      }
    });
  }

  // React to lightbox open/close (emitted by blue-contours-map.js)
  document.addEventListener("lightbox:open", async () => {
    if (!enabled) return;
    await analyzeCurrentImage();
    startLoop();
  });
  document.addEventListener("lightbox:close", () => {
    stopLoop(true);
  });

  // Resize canvas to match displayed image box
  function sizeCanvasToImage() {
    if (!imgEl || !canvas) return;
    const r = imgEl.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width  = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    canvas.width  = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Analyze (edge detect + contours) using OpenCV, on a downscaled copy for speed
  async function analyzeCurrentImage() {
    await ensureOpenCV();
    sizeCanvasToImage();
    clearCanvas();

    // Draw the displayed image onto an offscreen canvas at manageable resolution
    const r = imgEl.getBoundingClientRect();
    const maxW = Math.min(1024, r.width);
    const scale = maxW / r.width;

    const off = document.createElement('canvas');
    off.width  = Math.max(1, Math.round(r.width * scale));
    off.height = Math.max(1, Math.round(r.height * scale));
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(imgEl, 0, 0, off.width, off.height);

    // Read pixels to cv.Mat
    const src = cv.imread(off);
    let gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    // Canny edges
    let edges = new cv.Mat();
    cv.Canny(gray, edges, 80, 160, 3, false);

    // Find contours
    let cnts = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(edges, cnts, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    // Convert contours to array of points in *displayed-image pixel coords*
    const scaleBack = 1 / scale;
    const cList = [];
    for (let i = 0; i < cnts.size(); i++) {
      const c = cnts.get(i);
      const pts = [];
      for (let j = 0; j < c.data32S.length; j += 2) {
        const x = c.data32S[j] * scaleBack;
        const y = c.data32S[j + 1] * scaleBack;
        pts.push({ x, y });
      }
      if (pts.length >= 50) cList.push(pts);
      c.delete();
    }

    // Sort by descending perimeter length and take top N
    cList.sort((a, b) => polyLength(b) - polyLength(a));
    contoursPx = cList.slice(0, MAX_CONTOURS);

    // Clean up mats
    src.delete(); gray.delete(); edges.delete(); cnts.delete(); hierarchy.delete();

    // Compute main (largest) Fourier coefficients
    await computeMainCoeffs();
  }

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      L += Math.hypot(dx, dy);
    }
    return L;
  }

  async function computeMainCoeffs() {
    mainCoeffs = null;
    if (!contoursPx.length) return;

    // Largest contour
    const pts = contoursPx[0];

    // Uniformly resample to fixed count for stable DFT
    const targetN = Math.min(1000, Math.max(200, Math.floor(pts.length / 2)));
    const resampled = resamplePolyline(pts, targetN);

    // Build complex sequence
    const seq = resampled.map(p => ({ x: p.x, y: p.y }));

    // DFT coefficients for k = -order..order
    mainCoeffs = [];
    const N = seq.length;
    for (let k = -order; k <= order; k++) {
      let a = 0, b = 0; // cosine/sine parts for x; use the same for y separately
      let cx = 0, sx = 0, cy = 0, sy = 0;
      let reX = 0, imX = 0, reY = 0, imY = 0;
      for (let n = 0; n < N; n++) {
        const phi = (2 * Math.PI * k * n) / N;
        const c = Math.cos(phi), s = Math.sin(phi);
        // x component
        reX += seq[n].x * c;
        imX -= seq[n].x * s;
        // y component
        reY += seq[n].y * c;
        imY -= seq[n].y * s;
      }
      reX /= N; imX /= N; reY /= N; imY /= N;
      mainCoeffs.push({ k, reX, imX, reY, imY });
    }

    // Sort by frequency magnitude (draw lower |k| first for cleaner circles)
    mainCoeffs.sort((A, B) => Math.abs(A.k) - Math.abs(B.k));
  }

  // Uniformly resample a polyline to N points
  function resamplePolyline(pts, N) {
    if (pts.length <= 2 || N <= 2) return pts.slice();
    // cumulative lengths
    const d = [0];
    for (let i = 1; i < pts.length; i++) {
      d[i] = d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const L = d[d.length - 1] || 1;
    const out = [];
    for (let i = 0; i < N; i++) {
      const s = (L * i) / (N - 1);
      // find segment
      let j = 0;
      while (j < d.length - 1 && d[j + 1] < s) j++;
      const t = (s - d[j]) / Math.max(1e-6, (d[j + 1] - d[j]));
      const x = pts[j].x + t * (pts[j + 1].x - pts[j].x);
      const y = pts[j].y + t * (pts[j + 1].y - pts[j].y);
      out.push({ x, y });
    }
    return out;
  }

  // Animation loop
  function startLoop() {
    stopLoop(false);
    t = 0;
    const tick = () => {
      if (!enabled || !lightbox?.classList.contains("open")) return;
      drawFrame();
      t = (t + 0.006) % 1;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop(clear = false) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (clear) clearCanvas();
  }
  function clearCanvas() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawFrame() {
    clearCanvas();

    // Draw all contours statically
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.2;
    for (const path of contoursPx) {
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
    }

    // Draw epicycles on main contour
    if (mainCoeffs && showCircles) {
      drawEpicycles(mainCoeffs, t);
    }
  }

  function drawEpicycles(coeffs, t) {
    // Epicycles: start at the vector sum origin
    let x = 0, y = 0;
    ctx.save();
    ctx.globalAlpha = 0.9;

    // Draw each phasor circle + vector
    for (const c of coeffs) {
      const phi = 2 * Math.PI * c.k * t;
      const vx =  c.reX * Math.cos(phi) - c.imX * Math.sin(phi);
      const vy =  c.reY * Math.cos(phi) - c.imY * Math.sin(phi);

      const nx = x + vx;
      const ny = y + vy;

      // Circle radius = vector length
      const r = Math.hypot(vx, vy);
      if (r > 0.5) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(100,180,255,0.35)";
        ctx.lineWidth = 1;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Vector line
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = "rgba(80,220,255,0.9)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      x = nx; y = ny;
    }

    // Current point
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Keep canvas sized with image when window/layout changes
  const ro = new ResizeObserver(() => {
    if (!lightbox?.classList.contains("open")) return;
    sizeCanvasToImage();
  });
  if (imgEl) ro.observe(imgEl);

})();
