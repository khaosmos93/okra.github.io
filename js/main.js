import { WaterSim } from './water.js';

const sim = new WaterSim(document.getElementById('water'));

// input: click/drag to add impulses
function toGrid(e) {
  const rect = sim.cvs.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const gx = Math.floor(cssX / rect.width * sim.gw);
  const gy = Math.floor(cssY / rect.height * sim.gh);
  return { gx, gy };
}

let dragging = false;
sim.cvs.addEventListener('pointerdown', e => {
  dragging = true;
  const { gx, gy } = toGrid(e);
  sim.clickQueue.push({ x: gx, y: gy, amp: 2.0, radius: 6 });
});
sim.cvs.addEventListener('pointermove', e => {
  if (!dragging) return;
  const { gx, gy } = toGrid(e);
  sim.clickQueue.push({ x: gx, y: gy, amp: 1.0, radius: 5 });
});
['pointerup','pointercancel','pointerleave'].forEach(ev => {
  sim.cvs.addEventListener(ev, () => dragging = false);
});

// main loop
function loop() {
  sim.step();
  sim.render();
  requestAnimationFrame(loop);
}
loop();
