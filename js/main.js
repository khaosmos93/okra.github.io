import { WaterSim } from './water.js';

const sim = new WaterSim(document.getElementById('water'));

function toGrid(e){
  const r = sim.cvs.getBoundingClientRect();
  return {
    gx: Math.floor((e.clientX - r.left) / r.width  * sim.gw),
    gy: Math.floor((e.clientY - r.top ) / r.height * sim.gh),
  };
}

let dragging = false;
sim.cvs.addEventListener('pointerdown', e => {
  dragging = true;
  const { gx, gy } = toGrid(e);
  sim.clickQueue.push({ x: gx, y: gy, amp: sim.IMPULSE_AMP, radius: sim.IMPULSE_RADIUS });
});
sim.cvs.addEventListener('pointermove', e => {
  if (!dragging) return;
  const { gx, gy } = toGrid(e);
  sim.clickQueue.push({ x: gx, y: gy, amp: sim.IMPULSE_AMP*0.7, radius: sim.IMPULSE_RADIUS - 2 });
});
['pointerup','pointercancel','pointerleave'].forEach(ev=>{
  sim.cvs.addEventListener(ev, ()=> dragging=false);
});

// Keyboard: I = toggle 2 emitters; C = clear emitters
let emittersOn = false;
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'i') {
    emittersOn = !emittersOn;
    sim.clearEmitters();
    if (emittersOn) {
      // two out-of-phase sources → clear interference fringes
      const w = sim.cvs.width / sim.DPR, h = sim.cvs.height / sim.DPR;
      sim.addEmitter(w*0.35, h*0.5, { amp: 1.0, freq: 1.0, phase: 0 });
      sim.addEmitter(w*0.65, h*0.5, { amp: 1.0, freq: 1.0, phase: Math.PI/2 });
    }
  } else if (e.key.toLowerCase() === 'c') {
    sim.clearEmitters();
    emittersOn = false;
  }
});

// Main loop with a rough dt (good enough for visuals)
let last = performance.now();
function loop(ts){
  const dt = Math.min(0.05, (ts - last) / 1000);
  last = ts;
  sim.step(dt);
  sim.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
