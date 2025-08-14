// Water ripple simulation (2‑D wave eq.); MIT.
// Goals: higher res, black background, longer wavelength.

export class WaterSim {
  constructor(canvas) {
    this.cvs = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    /* ---------- Tunables ---------- */
    this.GRID_SCALE = 1.5;      // CSS px per simulation cell. 1.5 = high res, 1.0 = ultra high.
    this.C = 0.36;              // wave speed (propagation speed)
    this.DAMP = 0.997;          // energy loss per step (higher => longer lasting waves)
    this.IMPULSE_RADIUS = 14;   // default click radius (larger => longer wavelengths)
    this.IMPULSE_AMP = 1.8;     // default click amplitude
    this.SMOOTHING_PASSES = 1;  // low‑pass filter passes each step (0..2). Helps longer wavelengths.

    /* ---------- State ---------- */
    this.gw = 0; this.gh = 0;
    this.h = null;    // height(t)
    this.hPrev = null;// height(t-1)
    this.hNext = null;// height(t+1)
    this.clickQueue = [];

    // Offscreen buffer (grid‑sized) for fast rendering
    this.osc = document.createElement('canvas');
    this.octx = this.osc.getContext('2d', { alpha: false });

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, hpx = innerHeight;
    this.cvs.width  = Math.floor(w * this.DPR);
    this.cvs.height = Math.floor(hpx * this.DPR);
    this.cvs.style.width  = w + 'px';
    this.cvs.style.height = hpx + 'px';

    // Simulation grid chosen from CSS pixels and GRID_SCALE
    this.gw = Math.max(160, Math.floor(w / this.GRID_SCALE));
    this.gh = Math.max(110, Math.floor(hpx / this.GRID_SCALE));

    const N = this.gw * this.gh;
    this.h     = new Float32Array(N);
    this.hPrev = new Float32Array(N);
    this.hNext = new Float32Array(N);

    // Offscreen buffer matches grid size
    this.osc.width  = this.gw;
    this.osc.height = this.gh;
  }

  idx(x,y) { return y * this.gw + x; }

  addImpulse(gx, gy, amp = this.IMPULSE_AMP, radius = this.IMPULSE_RADIUS) {
    const r2 = radius*radius;
    for (let y=Math.max(1,gy-radius); y<Math.min(this.gh-1, gy+radius); y++){
      for (let x=Math.max(1,gx-radius); x<Math.min(this.gw-1, gx+radius); x++){
        const dx = x-gx, dy = y-gy, d2 = dx*dx + dy*dy;
        if (d2 > r2) continue;
        // smooth bell‑shaped source (fewer high frequencies)
        const falloff = Math.exp(-d2 / (radius*0.6));
        this.h[this.idx(x,y)] += amp * falloff;
      }
    }
  }

  // Optional low‑pass blur to suppress high‑frequency ripples (longer apparent wavelength)
  smoothHeight() {
    // Single 5‑point average (separable style)
    for (let pass = 0; pass < this.SMOOTHING_PASSES; pass++) {
      for (let y=1; y<this.gh-1; y++){
        for (let x=1; x<this.gw-1; x++){
          const i = this.idx(x,y);
          const avg = (
            this.h[this.idx(x-1,y)] +
            this.h[this.idx(x+1,y)] +
            this.h[this.idx(x,y-1)] +
            this.h[this.idx(x,y+1)] +
            this.h[i]
          ) / 5;
          this.h[i] = avg;
        }
      }
    }
  }

  step() {
    // wave equation update (5‑point Laplacian)
    for (let y=1; y<this.gh-1; y++){
      for (let x=1; x<this.gw-1; x++){
        const i = this.idx(x,y);
        const lap =
          this.h[this.idx(x-1,y)] +
          this.h[this.idx(x+1,y)] +
          this.h[this.idx(x,y-1)] +
          this.h[this.idx(x,y+1)] -
          4 * this.h[i];

        this.hNext[i] = (2*this.h[i] - this.hPrev[i]) * this.DAMP + (this.C*this.C) * lap;
      }
    }

    // still borders
    for (let x=0; x<this.gw; x++){
      this.hNext[this.idx(x,0)] = 0;
      this.hNext[this.idx(x,this.gh-1)] = 0;
    }
    for (let y=0; y<this.gh; y++){
      this.hNext[this.idx(0,y)] = 0;
      this.hNext[this.idx(this.gw-1,y)] = 0;
    }

    // rotate buffers
    const tmp = this.hPrev; this.hPrev = this.h; this.h = this.hNext; this.hNext = tmp;

    // (optional) low‑pass to bias toward longer wavelengths
    if (this.SMOOTHING_PASSES > 0) this.smoothHeight();

    // apply queued impulses
    if (this.clickQueue.length){
      for (const c of this.clickQueue) this.addImpulse(c.x, c.y, c.amp, c.radius);
      this.clickQueue.length = 0;
    }
  }

  render() {
    const W = this.cvs.width, H = this.cvs.height;

    // Build a gw×gh grayscale image using specular‑like shading (bright on black)
    const img = this.octx.createImageData(this.gw, this.gh);
    const px  = img.data;

    // simple normal from central differences
    for (let y=1; y<this.gh-1; y++){
      for (let x=1; x<this.gw-1; x++){
        const i = this.idx(x,y);
        const sx = (this.h[this.idx(x+1,y)] - this.h[this.idx(x-1,y)]) * 4.0;
        const sy = (this.h[this.idx(x,y+1)] - this.h[this.idx(x,y-1)]) * 4.0;
        let nx = -sx, ny = -sy, nz = 1.0;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx*=inv; ny*=inv; nz*=inv;

        // light from upper‑right
        let Lx = 0.55, Ly = -0.25, Lz = 0.8;
        const Linv = 1 / Math.hypot(Lx, Ly, Lz);
        Lx*=Linv; Ly*=Linv; Lz*=Linv;

        const ndotl = Math.max(0, nx*Lx + ny*Ly + nz*Lz);
        // curve brightness for punchy highlights, keep black base
        const shade = Math.floor(Math.pow(ndotl, 1.5) * 255);

        const j = i * 4;
        px[j+0] = shade;
        px[j+1] = shade;
        px[j+2] = shade;
        px[j+3] = 255;
      }
    }

    this.octx.putImageData(img, 0, 0);

    // Draw to main canvas, scaled up; keep it crisp (no smoothing) or set to true for softer
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.osc, 0, 0, W, H);
  }
}
