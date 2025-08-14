// Water ripple simulation (2‑D wave equation).
// Black background; waves rendered in grayscale. Superposition + optional interference emitters.
// MIT.

export class WaterSim {
  constructor(canvas) {
    this.cvs = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    /* ---------- Tunables ---------- */
    this.GRID_SCALE = 1.5;   // CSS px per simulation cell (1.5=high res, 1.0=ultra)
    this.C = 0.36;           // wave speed (normalized)
    this.DAMP = 0.997;       // energy loss per step (higher => longer lasting)
    this.IMPULSE_RADIUS = 14;
    this.IMPULSE_AMP = 1.8;
    this.SMOOTHING_PASSES = 1;  // low‑pass (0..2) to bias toward longer wavelengths

    // grayscale mapping (amplitude -> brightness)
    this.AMPLIFY = 900;      // raise if waves look too dim; lower if too bright

    /* ---------- State ---------- */
    this.gw = 0; this.gh = 0;
    this.h = this.hPrev = this.hNext = null;
    this.clickQueue = [];

    // Optional continuous emitters for visible interference
    // Each frame: addImpulse(amp * sin(ωt + φ))
    this.emitters = [];  // [{gx,gy,amp,freq,phase,radius}]
    this.time = 0;

    // Offscreen (grid-sized) buffer for fast scaling
    this.osc = document.createElement('canvas');
    this.octx = this.osc.getContext('2d', { alpha: false });

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.cvs.width  = Math.floor(w * this.DPR);
    this.cvs.height = Math.floor(h * this.DPR);
    this.cvs.style.width = w + 'px';
    this.cvs.style.height = h + 'px';

    this.gw = Math.max(160, Math.floor(w / this.GRID_SCALE));
    this.gh = Math.max(110, Math.floor(h / this.GRID_SCALE));
    const N = this.gw * this.gh;
    this.h     = new Float32Array(N);
    this.hPrev = new Float32Array(N);
    this.hNext = new Float32Array(N);

    this.osc.width  = this.gw;
    this.osc.height = this.gh;
  }

  idx(x,y){ return y * this.gw + x; }

  addImpulse(gx, gy, amp=this.IMPULSE_AMP, radius=this.IMPULSE_RADIUS){
    const r2 = radius*radius;
    for (let y=Math.max(1,gy-radius); y<Math.min(this.gh-1, gy+radius); y++){
      for (let x=Math.max(1,gx-radius); x<Math.min(this.gw-1, gx+radius); x++){
        const dx=x-gx, dy=y-gy, d2=dx*dx+dy*dy;
        if (d2>r2) continue;
        const falloff = Math.exp(-d2/(radius*0.6)); // bell-shaped source (fewer high freqs)
        this.h[this.idx(x,y)] += amp * falloff;
      }
    }
  }

  // Optional bias toward longer wavelengths (soft low-pass)
  smoothHeight(){
    for (let pass=0; pass<this.SMOOTHING_PASSES; pass++){
      for (let y=1; y<this.gh-1; y++){
        for (let x=1; x<this.gw-1; x++){
          const i=this.idx(x,y);
          this.h[i] = (this.h[this.idx(x-1,y)] + this.h[this.idx(x+1,y)] +
                       this.h[this.idx(x,y-1)] + this.h[this.idx(x,y+1)] +
                       this.h[i]) / 5;
        }
      }
    }
  }

  // ---- Interference emitters (optional) ----
  addEmitter(cssX, cssY, { amp=1.2, freq=1.1, phase=0, radius=this.IMPULSE_RADIUS } = {}){
    // map CSS coords to grid coords
    const gx = Math.floor(cssX / (this.cvs.width/this.DPR)  * this.gw);
    const gy = Math.floor(cssY / (this.cvs.height/this.DPR) * this.gh);
    this.emitters.push({ gx, gy, amp, freq, phase, radius });
  }
  clearEmitters(){ this.emitters.length = 0; }

  step(dt=1/60){
    this.time += dt;

    // wave eq. (5‑point Laplacian) + damping
    for (let y=1; y<this.gh-1; y++){
      for (let x=1; x<this.gw-1; x++){
        const i = this.idx(x,y);
        const lap = this.h[this.idx(x-1,y)] + this.h[this.idx(x+1,y)] +
                    this.h[this.idx(x,y-1)] + this.h[this.idx(x,y+1)] - 4*this.h[i];
        this.hNext[i] = (2*this.h[i] - this.hPrev[i]) * this.DAMP + (this.C*this.C) * lap;
      }
    }

    // still borders
    for (let x=0; x<this.gw; x++){ this.hNext[this.idx(x,0)] = this.hNext[this.idx(x,this.gh-1)] = 0; }
    for (let y=0; y<this.gh; y++){ this.hNext[this.idx(0,y)] = this.hNext[this.idx(this.gw-1,y)] = 0; }

    // rotate buffers
    const tmp = this.hPrev; this.hPrev = this.h; this.h = this.hNext; this.hNext = tmp;

    // (optional) bias toward longer λ
    if (this.SMOOTHING_PASSES>0) this.smoothHeight();

    // queued clicks (point sources) — linear superposition
    if (this.clickQueue.length){
      for (const c of this.clickQueue) this.addImpulse(c.x, c.y, c.amp, c.radius);
      this.clickQueue.length = 0;
    }

    // continuous emitters for visible interference (linear superposition)
    if (this.emitters.length){
      for (const e of this.emitters){
        const phase = 2*Math.PI*e.freq*this.time + e.phase;
        const a = e.amp * Math.sin(phase);
        if (Math.abs(a) > 1e-3) this.addImpulse(e.gx, e.gy, a, e.radius);
      }
    }
  }

  render(){
    // Black background: we only draw gray pixels for waves.
    const img = this.octx.createImageData(this.gw, this.gh);
    const px = img.data;

    // Map |amplitude| -> brightness (gray on black)
    // Using absolute height emphasizes both crests/troughs.
    for (let i=0; i<this.gw*this.gh; i++){
      const shade = Math.min(255, Math.floor(Math.abs(this.h[i]) * this.AMPLIFY));
      const j = i*4;
      px[j] = px[j+1] = px[j+2] = shade; // grayscale
      px[j+3] = 255;
    }

    this.octx.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.osc, 0, 0, this.cvs.width, this.cvs.height);
  }
}
