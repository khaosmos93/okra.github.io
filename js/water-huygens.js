/* Water + Letters renderer with Huygens (2-D wave equation) ripples.
   MIT License — do as you wish. */

const POEM_LINES = [
  "물결 위에 흩어진 이름들,",
  "바람이 스치면 다시 빛나고",
  "가라앉는 동안에도",
  "서로의 음영으로 남는다."
];
// For English demo:
// const POEM_LINES = ["Names scattered on the water,", "the wind brushes— they shine again,", "even while sinking,", "they remain each other’s shade."];

const FONT_FAMILY = 'ui-sans-serif, -apple-system, Segoe UI, Roboto, "Noto Sans", "Apple SD Gothic Neo", system-ui';
const MAX_FPS = 60;

const cvs = document.getElementById('stage');
const ctx = cvs.getContext('2d', { alpha: true });
let DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

/* ---------------------- size & utilities ---------------------- */
function cssVar(name){
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
}
function numVar(name){
  return parseFloat(cssVar(name).replace('px','')) || 0;
}
const clamp = (x,a,b)=>Math.min(b,Math.max(a,x));
const lerp  = (a,b,t)=> a + (b-a)*t;
const rand  = (a=0,b=1)=> a + Math.random()*(b-a);

function resize(){
  const w = innerWidth, h = innerHeight;
  cvs.width  = Math.floor(w * DPR);
  cvs.height = Math.floor(h * DPR);
  cvs.style.width  = w + 'px';
  cvs.style.height = h + 'px';
  buildPoemLayout();
  buildSimulation();
}
addEventListener('resize', resize);

/* ------------------- wave simulation (Huygens) -------------------
   Discrete 2-D wave equation on a coarse grid (height field).
   h_next = (2 - γ) h - (1 - γ) h_prev + c^2 Δt^2 ∇² h
   We render specular lighting from the height map, and letters appear
   only where specular exceeds a threshold (so letters == glints).
------------------------------------------------------------------- */

let gridW, gridH, h, hPrev, hNext;  // Float32Array
const C = 0.35;      // wave speed (tune)
const DAMP = 0.996;  // damping (near 1 => long-lasting)
const KERNEL = [0,1,0, 1,-4,1, 0,1,0]; // 5-point Laplacian
let clickQueue = []; // impulses to add each frame

function buildSimulation(){
  // pick a grid ~1/3 of CSS pixels for speed
  gridW = Math.max(120, Math.floor((cvs.width / DPR) / 3));
  gridH = Math.max(80,  Math.floor((cvs.height/ DPR) / 3));
  const N = gridW * gridH;
  h = new Float32Array(N);
  hPrev = new Float32Array(N);
  hNext = new Float32Array(N);
}

function idx(x,y){ return y*gridW + x; }

function addImpulse(px, py, amp=1, radius=10){
  // px,py in grid coords
  const r2 = radius*radius;
  for(let y=Math.max(1,py-radius); y<Math.min(gridH-1, py+radius); y++){
    for(let x=Math.max(1,px-radius); x<Math.min(gridW-1, px+radius); x++){
      const dx = x-px, dy = y-py, d2 = dx*dx+dy*dy;
      if (d2 > r2) continue;
      const falloff = Math.exp(-d2/(radius*0.6));
      h[idx(x,y)] += amp * falloff;
    }
  }
}

function stepWaves(){
  // simple wave equation with Laplacian
  for(let y=1;y<gridH-1;y++){
    for(let x=1;x<gridW-1;x++){
      const i = idx(x,y);
      const lap = h[idx(x-1,y)] + h[idx(x+1,y)] + h[idx(x,y-1)] + h[idx(x,y+1)] - 4*h[i];
      // next height
      hNext[i] = (2*h[i] - hPrev[i]) * DAMP + (C*C)*lap;
    }
  }
  // border clamp
  for(let x=0;x<gridW;x++){ hNext[idx(x,0)]=hNext[idx(x,gridH-1)]=0; }
  for(let y=0;y<gridH;y++){ hNext[idx(0,y)]=hNext[idx(gridW-1,y)]=0; }

  // rotate buffers
  const tmp = hPrev; hPrev = h; h = hNext; hNext = tmp;

  // apply queued impulses (mouse clicks)
  if (clickQueue.length){
    for(const c of clickQueue) addImpulse(c.x, c.y, c.amp, c.radius);
    clickQueue.length = 0;
  }
}

/* ------------------------ shading helpers ------------------------ */
function sampleHeightCSS(cssX, cssY){
  // cssX/Y in CSS pixels; map to grid coords
  const gx = clamp(Math.floor(cssX / (cvs.width/DPR * 1.0) * gridW), 1, gridW-2);
  const gy = clamp(Math.floor(cssY / (cvs.height/DPR* 1.0) * gridH), 1, gridH-2);
  return h[idx(gx,gy)];
}
function normalFromHeight(cssX, cssY){
  const gx = clamp(Math.floor(cssX / (cvs.width/DPR) * gridW), 1, gridW-2);
  const gy = clamp(Math.floor(cssY / (cvs.height/DPR) * gridH), 1, gridH-2);
  // central differences (scaled)
  const sx = (h[idx(gx+1,gy)] - h[idx(gx-1,gy)]) * (gridW / (cvs.width/DPR));
  const sy = (h[idx(gx,gy+1)] - h[idx(gx,gy-1)]) * (gridH / (cvs.height/DPR));
  // normal pointing up
  let nx = -sx, ny = -sy, nz = 1.0;
  const inv = 1/Math.hypot(nx,ny,nz);
  return { x:nx*inv, y:ny*inv, z:nz*inv };
}
function specularAt(cssX, cssY){
  const n = normalFromHeight(cssX, cssY);
  // single distant light (upper-right)
  let L = { x: 0.55, y: -0.25, z: 0.8 };
  const Llen = 1/Math.hypot(L.x,L.y,L.z); L.x*=Llen; L.y*=Llen; L.z*=Llen;
  const V = { x:0, y:0, z:1 };
  const H = { x:L.x+V.x, y:L.y+V.y, z:L.z+V.z };
  const Hlen=1/Math.hypot(H.x,H.y,H.z); H.x*=Hlen; H.y*=Hlen; H.z*=Hlen;

  const ndotl = Math.max(0, n.x*L.x + n.y*L.y + n.z*L.z);
  const ndoth = Math.max(0, n.x*H.x + n.y*H.y + n.z*H.z);
  const power = numVar('--specular-power') || 28;
  return Math.pow(ndoth, power) * (0.7 + 0.3*Math.pow(1-ndotl, 3));
}

/* --------------------- letters as glints ---------------------- */
let lines = []; // [{glyphs:[{ch,x,y,jx,jy}], y0, size}]
function buildPoemLayout(){
  lines = [];
  const W = cvs.width / DPR;
  const baseY = innerHeight*0.45 - (POEM_LINES.length-1)*numVar('--line-gap')/2;

  POEM_LINES.forEach((text, idx)=>{
    const size = lerp(numVar('--font-min'), numVar('--font-max'),
                      (POEM_LINES.length>1)? idx/(POEM_LINES.length-1) : 0.5);
    ctx.font = `${size*DPR}px ${FONT_FAMILY}`;

    const chars = [...text];
    const spacing = size * 0.7; // crude monospace-like spacing
    const total = chars.length * spacing;
    let x = (W - total)/2;

    const glyphs = chars.map(ch => {
      const g = {
        ch,
        x: x*DPR,
        y: 0,
        jx: rand(-numVar('--letter-jitter'), numVar('--letter-jitter'))*DPR,
        jy: rand(-numVar('--letter-jitter'), numVar('--letter-jitter'))*DPR
      };
      x += spacing;
      return g;
    });
    lines.push({ glyphs, y0: (baseY + idx*numVar('--line-gap'))*DPR, size: size*DPR });
  });
}

/* ------------------------ input (Huygens) ------------------------ */
function toGrid(e){
  const rect = cvs.getBoundingClientRect();
  const cssX = (e.clientX - rect.left);
  const cssY = (e.clientY - rect.top);
  const gx = Math.floor(cssX / rect.width  * gridW);
  const gy = Math.floor(cssY / rect.height * gridH);
  return { gx, gy };
}
let dragging = false;
cvs.addEventListener('pointerdown', e=>{
  dragging = true;
  const { gx, gy } = toGrid(e);
  // A click creates a compact impulse; dragging leaves a trail
  clickQueue.push({ x:gx, y:gy, amp: 1.8, radius: 8 });
});
cvs.addEventListener('pointermove', e=>{
  if (!dragging) return;
  const { gx, gy } = toGrid(e);
  clickQueue.push({ x:gx, y:gy, amp: 1.2, radius: 7 });
});
['pointerup','pointercancel','pointerleave'].forEach(ev=>{
  cvs.addEventListener(ev, ()=> dragging=false);
});

/* --------------------------- loop --------------------------- */
let last=0;
function loop(ts){
  // cap FPS
  const step = 1000 / MAX_FPS;
  if (ts - last < step) return requestAnimationFrame(loop);
  last = ts;

  stepWaves();
  render(ts);

  requestAnimationFrame(loop);
}

function render(ts){
  const W = cvs.width, H = cvs.height;

  // clear frame with a faint vignette layer (kept in CSS bg, but add soft dark)
  ctx.clearRect(0,0,W,H);
  const grad = ctx.createRadialGradient(W*0.5, H*0.25, Math.min(W,H)*0.2, W*0.5, H*0.5, Math.hypot(W,H)*0.8);
  grad.addColorStop(0, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  // draw letters where specular is strong
  const thr = numVar('--specular-threshold') || 0.22;
  const rgb = cssVar('--glint-rgb') || '235,245,255';
  const glow1 = numVar('--glow-1')*DPR, glow2 = numVar('--glow-2')*DPR;

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  for (const line of lines){
    // bob & ribbon undulation for the whole line
    const t = ts/1000;
    const bob = Math.sin(t*1.4 + line.y0*0.0003)* numVar('--line-float')*DPR;
    const und = Math.sin(t*0.9 + line.y0*0.0007)* 6*DPR;

    ctx.font = `${line.size}px ${FONT_FAMILY}`;

    for (let i=0;i<line.glyphs.length;i++){
      const g = line.glyphs[i];
      const gx = g.x + Math.sin(i*0.4 + t*1.2)*und + g.jx;
      const gy = line.y0 + bob + g.jy;

      const s = specularAt(gx/DPR, gy/DPR);   // 0..1
      if (s <= thr) continue;
      const k = (s - thr) / (1 - thr);
      const alpha = clamp(0.15 + k*0.95, 0, 1);

      ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
      ctx.shadowColor = `rgba(${rgb}, ${0.35*k})`;
      ctx.shadowBlur = glow1 * k;
      ctx.fillText(g.ch, gx, gy);

      ctx.shadowBlur = glow2 * k*0.7;
      ctx.fillText(g.ch, gx, gy);
      ctx.shadowBlur = 0;
    }
  }
}

/* ------------------------- boot ------------------------- */
resize();
requestAnimationFrame(loop);
