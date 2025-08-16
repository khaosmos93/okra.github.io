// js/bouncing-globe.js
(() => {
  // ---- Config ----
  const DEST_URL = 'map.html';      // where a click on the globe goes
  const SIZE_MIN = 78;              // px (scales up on bigger viewports)
  const SIZE_MAX = 132;             // px
  const SPEED_MIN = 70;             // px/s
  const SPEED_MAX = 140;            // px/s
  const Z_INDEX   = 25;             // above your poem layer (15) and titles (10)
  const MARGIN    = 8;              // keep a small gutter from edges

  // Respect reduced motion
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Create the globe element ----
  const globe = document.createElement('a');
  globe.href = DEST_URL;
  globe.setAttribute('aria-label', 'Open map');
  globe.id = 'glass-globe';
  Object.assign(globe.style, {
    position: 'fixed',
    left: '0px',
    top:  '0px',
    width: '100px',
    height:'100px',
    borderRadius: '50%',
    zIndex: String(Z_INDEX),
    // Glass look that refracts/warps the content behind it (browser support dependent)
    backdropFilter: 'blur(8px) saturate(1.15) contrast(1.08) brightness(1.05)',
    WebkitBackdropFilter: 'blur(8px) saturate(1.15) contrast(1.08) brightness(1.05)',
    background:
      'radial-gradient(120% 120% at 30% 30%, rgba(255,255,255,.35), rgba(255,255,255,.06) 50%, rgba(255,255,255,0) 60%)',
    boxShadow:
      // outer glow + soft cast shadow + inner rim
      '0 6px 18px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.35), inset 0 18px 28px rgba(255,255,255,.06)',
    cursor: 'pointer',
    userSelect: 'none',
    // keep the element strictly circular and only this circle clickable
    overflow: 'hidden',
    // prevent accidental text selection or drag
    touchAction: 'manipulation',
    // Optional: subtle sheen
    backgroundClip: 'padding-box',
  });

  // Little specular highlight element (for depth)
  const glare = document.createElement('div');
  Object.assign(glare.style, {
    position: 'absolute',
    left: '12%',
    top: '10%',
    width: '40%',
    height:'40%',
    borderRadius: '50%',
    background: 'radial-gradient(closest-side, rgba(255,255,255,.45), rgba(255,255,255,0))',
    pointerEvents: 'none',
    filter: 'blur(0.5px)',
  });
  globe.appendChild(glare);

  // Small “shadow” underneath (helps the ball float visually)
  const shadow = document.createElement('div');
  Object.assign(shadow.style, {
    position: 'absolute',
    left: '15%',
    bottom: '-10%',
    width: '70%',
    height: '18%',
    background: 'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.35), rgba(0,0,0,0))',
    filter: 'blur(4px)',
    pointerEvents: 'none',
  });
  globe.appendChild(shadow);

  document.body.appendChild(globe);

  // ---- Size based on viewport ----
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  function computeSize() {
    const s = Math.round(clamp(Math.min(window.innerWidth, window.innerHeight) * 0.12, SIZE_MIN, SIZE_MAX));
    globe.style.width  = s + 'px';
    globe.style.height = s + 'px';
    return s;
  }
  let size = computeSize();

  // ---- Initial position & velocity ----
  // Start somewhere not covering the middle much (to not fight with poem center)
  let x = window.innerWidth  * 0.72;
  let y = window.innerHeight * 0.18;

  // Random direction & speed
  function rand(min, max){ return min + Math.random()*(max-min); }
  const speed = reduceMotion ? 0 : rand(SPEED_MIN, SPEED_MAX); // px/s
  let angle = rand(0, Math.PI*2);
  let vx = speed * Math.cos(angle);
  let vy = speed * Math.sin(angle);

  // ---- Animation loop ----
  let last = performance.now();
  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;

    // bounds
    const w = window.innerWidth;
    const h = window.innerHeight;

    // move
    x += vx * dt;
    y += vy * dt;

    // Collide with walls (simple elastic bounce)
    if (x < MARGIN) { x = MARGIN; vx = Math.abs(vx); }
    if (y < MARGIN) { y = MARGIN; vy = Math.abs(vy); }
    if (x + size > w - MARGIN) { x = w - MARGIN - size; vx = -Math.abs(vx); }
    if (y + size > h - MARGIN) { y = h - MARGIN - size; vy = -Math.abs(vy); }

    globe.style.transform = `translate(${x}px, ${y}px)`;

    raf = requestAnimationFrame(tick);
  }
  let raf = requestAnimationFrame(tick);

  // ---- Resize handling (visualViewport aware) ----
  const onResize = () => {
    size = computeSize();
    // Nudge inside bounds if needed
    x = Math.min(Math.max(x, MARGIN), Math.max(0, window.innerWidth  - size - MARGIN));
    y = Math.min(Math.max(y, MARGIN), Math.max(0, window.innerHeight - size - MARGIN));
  };
  addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  // ---- Interactions ----
  // Pause bounce while pointer is down (makes clicking easier)
  let paused = false;
  function pause() { if (!paused){ paused = true; cancelAnimationFrame(raf); } }
  function resume(){
    if (paused){
      paused = false;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  globe.addEventListener('pointerdown', pause);
  globe.addEventListener('pointerup', resume);
  globe.addEventListener('pointercancel', resume);
  globe.addEventListener('pointerleave', ()=>{ /* keep pausing while hovering helps targeting */ });

  // Drag to “throw” a bit (minimal physics, optional)
  let dragStart = null;
  globe.addEventListener('pointerdown', (e) => {
    globe.setPointerCapture(e.pointerId);
    dragStart = { x: e.clientX, y: e.clientY, t: performance.now(), sx: x, sy: y };
  });
  globe.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    x = dragStart.sx + dx;
    y = dragStart.sy + dy;
    globe.style.transform = `translate(${x}px, ${y}px)`;
  });
  globe.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const dt = (performance.now() - dragStart.t) / 1000 || 0.016;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    // throw velocity based on drag distance
    vx = clamp(dx / dt, -SPEED_MAX, SPEED_MAX);
    vy = clamp(dy / dt, -SPEED_MAX, SPEED_MAX);
    dragStart = null;
    resume();
  });

  // Don’t steal keyboard focus from the page
  globe.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      // navigate
      window.location.href = DEST_URL;
    }
  });

  // ---- Safety: don’t interfere with your Poem UI / water clicks ----
  // Only the circular element is clickable; everything else on page remains untouched.
  // We also keep the element relatively small and at high z-index so it doesn’t cover
  // large interaction zones.

  // ---- Optional polish: faint border shimmer that tracks mouse (parallax) ----
  addEventListener('pointermove', (e) => {
    // quick, cheap parallax for the highlight
    const rect = globe.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    glare.style.transform = `translate(${dx * 10}px, ${dy * 10}px)`;
  });
})();
