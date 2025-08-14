export class WaterSim {
  constructor(canvas) {
    this.cvs = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    // simulation params
    this.C = 0.36;     // wave speed
    this.DAMP = 0.995; // damping
    this.gw = 0;
    this.gh = 0;
    this.h = null;
    this.hPrev = null;
    this.hNext = null;
    this.clickQueue = [];

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, hpx = innerHeight;
    this.cvs.width  = Math.floor(w * this.DPR);
    this.cvs.height = Math.floor(hpx * this.DPR);
    this.cvs.style.width = w + 'px';
    this.cvs.style.height = hpx + 'px';

    // choose grid resolution ~1/3 CSS pixels for speed
    this.gw = Math.max(120, Math.floor(w / 3));
    this.gh = Math.max(80,  Math.floor(hpx / 3));
    const N = this.gw * this.gh;
    this.h = new Float32Array(N);
    this.hPrev = new Float32Array(N);
    this.hNext = new Float32Array(N);
  }

  idx(x,y) { return y * this.gw + x; }

  addImpulse(gx, gy, amp=1.5, radius=8) {
    const r2 = radius*radius;
    for(let y=Math.max(1,gy-radius); y<Math.min(this.gh-1, gy+radius); y++){
      for(let x=Math.max(1,gx-radius); x<Math.min(this.gw-1, gx+radius); x++){
        const dx = x-gx, dy = y-gy, d2 = dx*dx+dy*dy;
        if (d2 > r2) continue;
        const falloff = Math.exp(-d2/(radius*0.6));
        this.h[this.idx(x,y)] += amp * falloff;
      }
    }
  }

  step() {
    for(let y=1; y<this.gh-1; y++){
      for(let x=1; x<this.gw-1; x++){
        const i = this.idx(x,y);
        const lap = this.h[this.idx(x-1,y)] + this.h[this.idx(x+1,y)] +
                    this.h[this.idx(x,y-1)] + this.h[this.idx(x,y+1)] -
                    4*this.h[i];
        this.hNext[i] = (2*this.h[i] - this.hPrev[i]) * this.DAMP + (this.C*this.C) * lap;
      }
    }
    // border = still water
    for(let x=0; x<this.gw; x++){
      this.hNext[this.idx(x,0)] = 0;
      this.hNext[this.idx(x,this.gh-1)] = 0;
    }
    for(let y=0; y<this.gh; y++){
      this.hNext[this.idx(0,y)] = 0;
      this.hNext[this.idx(this.gw-1,y)] = 0;
    }
    // rotate buffers
    const tmp = this.hPrev;
    this.hPrev = this.h;
    this.h = this.hNext;
    this.hNext = tmp;

    // apply queued impulses
    if (this.clickQueue.length) {
      for (const c of this.clickQueue) this.addImpulse(c.x, c.y, c.amp, c.radius);
      this.clickQueue.length = 0;
    }
  }

  render() {
    const W = this.cvs.width, H = this.cvs.height;
    const cellW = W / this.gw;
    const cellH = H / this.gh;
    const image = this.ctx.createImageData(W, H);
    const pixels = image.data;
    for (let gy=0; gy<this.gh; gy++) {
      for (let gx=0; gx<this.gw; gx++) {
        const v = this.h[this.idx(gx,gy)];
        const shade = 128 + v * 255; // map height to brightness
        const c = Math.max(0, Math.min(255, shade));
        for (let py=0; py<cellH; py++) {
          for (let px=0; px<cellW; px++) {
            const x = Math.floor(gx*cellW + px);
            const y = Math.floor(gy*cellH + py);
            const idxPix = (y * W + x) * 4;
            pixels[idxPix] = c;
            pixels[idxPix+1] = c;
            pixels[idxPix+2] = c;
            pixels[idxPix+3] = 255;
          }
        }
      }
    }
    this.ctx.putImageData(image, 0, 0);
  }
}
