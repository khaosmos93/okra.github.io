// Water ripple simulation (2‑D wave equation).
// Black background; waves in grayscale; linear superposition + optional interference emitters.
// MIT — do whatever you'd like.

export class WaterSim {
  constructor(canvas) {
    this.cvs = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    /* -------- Tunables (safe defaults) -------- */
    this.GRID_SCALE = 1.5;   // CSS px per simulation cell (1.5 = high res, 1.0 = ultra)
    this.C = 0.36;           // wave speed (normalized to grid spacing)
    this.DAMP = 0.997;       // damping (higher = waves persist longer)
    this.IMPULSE_RADIUS = 14;// click radius (larger = longer wavelength feel)
    this.IMPULSE_AMP = 1.8;  // click amplitude
    this.SMOOTHING_PASSES = 1; // low‑pass per step (0..2) → biases to longer λ

    // Amplitude → grayscale mapping
    this.AMPLIFY = 900;      // brightness gain (raise if too dim, lower if too bright)
    this.FLOOR   = 2;        // 0..255: values below are clamped to 0 (holds blacks)

    /* -------- State -------- */
    this.gw = 0; this.gh = 0;
    this.h = this.hPrev = this.hNext = null;
    this.clickQueue = [];

    // Optional continuous emitters for interference (controlled from outside if desired)
    // Each frame: addImpulse(amp * sin(ωt + φ))
    this.emitters = [];  // [{gx,gy,amp,freq,phase,radius}]
    this.time = 0;

    // Offscreen (grid-sized) buffer for fast, clean scaling
    this.osc = document.createElement('canvas');
    this.octx = this.osc.getContext('2d', { alpha: false });

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /* =================== Setup & sizing =================== */
  resize() {
    const w = innerWidth, h = innerHeight;

    // Device canvas
    this.cvs.width  = Math.floor(w * this.DPR);
    this.cvs.height = Math.floor(h * this.DPR);
    this.cvs.style.width  = w + 'px';
    this.cvs.style.height = h + 'px';

    // Simulation grid resolution derived from CSS pixels & GRID_SCALE
    this.gw = Math.max(160, Math.floor(w / this.GRID_SCALE));
    this.gh = Math.max(110, Math.floor(h / this.GRID_SCALE));

    const N = this.gw * this.gh;
    this.h     = new Float32Array(N);
    this.hPrev = new Float32Array(N);
    this.hNext = new Float32Array(N);

    // Offscreen buffer matches grid size exactly
    this.osc.width  = this.gw;
    this.osc.height = this.gh;
  }

  idx(x, y) { return y * this.gw + x; }

  /* =================== Sources / inputs =================== */
  addImpulse(gx, gy, amp = this.IMPULSE_AMP, radius = this.IMPULSE_RADIUS) {
    const r2 = radius * radius;
    for (let y = Math.max(1, gy - radius); y < Math.min(this.gh - 1, gy + radius); y++) {
      for (let x = Math.max(1, gx - radius); x < Math.min(this.gw - 1, gx + radius); x++) {
        const dx = x - gx, dy = y - gy, d2 = dx*dx + dy*dy;
        if (d2 > r2) continue;
        // Bell-shaped (Gaussian-like) falloff => fewer high frequencies
        const falloff = Math.exp(-d2 / (radius * 0.6));
        this.h[this.idx(x, y)] += amp * falloff;
      }
    }
  }

  addEmitter(cssX, cssY, { amp = 1.2, freq = 1.0, phase = 0, radius = this.IMPULSE_RADIUS } = {}) {
    // Map CSS coords to grid coords
    const gx = Math.floor(cssX / (this.cvs.width  / this.DPR) * this.gw);
    const gy = Math.floor(cssY / (this.cvs.height / this.DPR) * this.gh);
    this.emitters.push({ gx, gy, amp, freq, phase, radius });
  }
  clearEmitters() { this.emitters.length = 0; }

  /* =========== Optional low‑pass (favor longer λ) =========== */
  smoothHeight() {
    for (let pass = 0; pass < this.SMOOTHING_PASSES; pass++) {
      for (let y = 1; y < this.gh - 1; y++) {
        for (let x = 1; x < this.gw - 1; x++) {
          const i = this.idx(x, y);
          this.h[i] = (
            this.h[this.idx(x-1,y)] +
            this.h[this.idx(x+1,y)] +
            this.h[this.idx(x,y-1)] +
            this.h[this.idx(x,y+1)] +
            this.h[i]
          ) / 5;
        }
      }
    }
  }

  /* =================== Simulation step =================== */
  step(dt = 1/60) {
    this.time += dt;

    // Discrete 2‑D wave equation (5‑point Laplacian) + damping
    for (let y = 1; y < this.gh - 1; y++) {
      for (let x = 1; x < this.gw - 1; x++) {
        const i = this.idx(x, y);
        const lap =
          this.h[this.idx(x-1,y)] +
          this.h[this.idx(x+1,y)] +
          this.h[this.idx(x,y-1)] +
          this.h[this.idx(x,y+1)] -
          4 * this.h[i];

        // h_next = (2 - γ) h - (1 - γ) h_prev + c^2 ∇² h
        this.hNext[i] = (2 * this.h[i] - this.hPrev[i]) * this.DAMP + (this.C * this.C) * lap;
      }
    }

    // Still borders (no wrap)
    for (let x = 0; x < this.gw; x++) {
      this.hNext[this.idx(x, 0)] = 0;
      this.hNext[this.idx(x, this.gh - 1)] = 0;
    }
    for (let y = 0; y < this.gh; y++) {
      this.hNext[this.idx(0, y)] = 0;
      this.hNext[this.idx(this.gw - 1, y)] = 0;
    }

    // Rotate buffers
    const tmp = this.hPrev; this.hPrev = this.h; this.h = this.hNext; this.hNext = tmp;

    // Favor longer wavelengths if requested
    if (this.SMOOTHING_PASSES > 0) this.smoothHeight();

    // Queued click impulses (Huygens superposition: linear add)
    if (this.clickQueue.length) {
      for (const c of this.clickQueue) this.addImpulse(c.x, c.y, c.amp, c.radius);
      this.clickQueue.length = 0;
    }

    // Continuous emitters (optional; also linear superposition)
    if (this.emitters.length) {
      for (const e of this.emitters) {
        const phase = 2 * Math.PI * e.freq * this.time + e.phase;
        const a = e.amp * Math.sin(phase);
        if (Math.abs(a) > 1e-3) this.addImpulse(e.gx, e.gy, a, e.radius);
      }
    }
  }

  /* =================== Rendering =================== */
  render() {
    const W = this.cvs.width, H = this.cvs.height;

    // Ensure destination is true black every frame
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, W, H);

    // Build a gw×gh grayscale image from |amplitude|
    const img = this.octx.createImageData(this.gw, this.gh);
    const px  = img.data;
    const GAIN = this.AMPLIFY;
    const FLOOR = this.FLOOR;

    // Map |h| → [0..255], with small values clamped to 0 (hard black base)
    const N = this.gw * this.gh;
    for (let i = 0; i < N; i++) {
      let shade = Math.abs(this.h[i]) * GAIN;          // no mid-gray baseline
      shade = shade < FLOOR ? 0 : (shade > 255 ? 255 : shade);
      const j = i * 4;
      px[j] = px[j+1] = px[j+2] = shade;               // grayscale on black
      px[j+3] = 255;
    }
    this.octx.putImageData(img, 0, 0);

    // Scale to screen. Smoothing off = crisper, on = softer.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.osc, 0, 0, W, H);
  }
}
