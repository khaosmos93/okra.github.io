// Transparent poem UI over water (updated to fix X-scroll + size reset).
// - No horizontal page scrollbar from overlay
// - Titles & poem float on waves
// - Auto-fit resets per poem (no “permanently small” text)
// - iOS-friendly sizing with svh/svw and viewport listeners

const CANVAS_ID     = 'water';
const MANIFEST_URL  = 'poem/poems.json';
const FADE_MS       = 400;
const TITLE_LINGER  = 8000;  // 0 => never auto-remove
const MAX_TITLES    = 18;

// Leaf-like motion
const FLOAT_GAIN    = 10;
const ROT_GAIN      = 5;
const SWAY_PX       = 2;
const CONTRAST_GAIN = 3200;
const OPACITY_MIN   = 0.35;
const E             = 2;

// Poem layout baselines (reset to these every poem)
const LINE_GAP      = 34;
const TITLE_SIZE    = 22;
const BODY_SIZE     = 18;

// === helpers
function fontPx(el){ return parseFloat(getComputedStyle(el).fontSize) || 16; }
function clampDisp(el, dx, dy, factor = 1.5){
  const max = fontPx(el) * factor;
  let cx = Math.max(-max, Math.min(max, dx));
  let cy = Math.max(-max, Math.min(max, dy));
  const mag = Math.hypot(cx, cy);
  if (mag > max){ const s = max / mag; cx *= s; cy *= s; }
  return { dx: cx, dy: cy };
}
function px(el, prop) { return parseFloat(getComputedStyle(el)[prop]) || 0; }

function maxLineWidth(linesEl) {
  let maxW = 0;
  linesEl.querySelectorAll('.poem-line').forEach(line => {
    const w = line.getBoundingClientRect().width;
    if (w > maxW) maxW = w;
  });
  return maxW;
}

// Clear previous fit cache and restore baseline sizes
function resetFitCache(linesEl){
  if (!linesEl) return;
  // wipe caches on the container
  delete linesEl.dataset.origTitlePx;
  delete linesEl.dataset.origBodyPx;
  delete linesEl.dataset.origGapPx;
  // restore baseline sizes in CSS terms (before measuring)
  const titleEl = linesEl.querySelector('.poem-line.title');
  const bodyEls = linesEl.querySelectorAll('.poem-line.body');
  if (titleEl) titleEl.style.fontSize = `${TITLE_SIZE}px`;
  bodyEls.forEach(el => el.style.fontSize = `${BODY_SIZE}px`);
  linesEl.style.gap = `${Math.max(10, LINE_GAP - 12)}px`;
}

function fitPoemBlock(linesEl, { minTitle = 14, minBody = 12 } = {}) {
  if (!linesEl) return;

  const container = linesEl.parentElement || linesEl;

  const cw = container.clientWidth  || window.innerWidth;
  const ch = container.clientHeight || window.innerHeight;

  // Safety margins to avoid visual clipping from glyph bob/rotation
  const SAFE_HPAD = 16;   // match .poem-lines padding
  const SAFE_VPAD = 24;
  const EXTRA_X   = 8;
  const EXTRA_Y   = 24;

  const availW = Math.max(1, cw - SAFE_HPAD * 2);
  const availH = Math.max(1, ch - SAFE_VPAD);

  const titleEl = linesEl.querySelector('.poem-line.title');
  const bodyEl  = linesEl.querySelector('.poem-line.body') || titleEl;

  // Cache originals once (per render)
  if (!linesEl.dataset.origTitlePx) {
    linesEl.dataset.origTitlePx = String(px(titleEl, 'fontSize') || TITLE_SIZE);
    linesEl.dataset.origBodyPx  = String(px(bodyEl,  'fontSize') || BODY_SIZE);
    linesEl.dataset.origGapPx   = String(px(linesEl, 'rowGap') || px(linesEl, 'gap') || 20);
  }
  const origTitlePx = parseFloat(linesEl.dataset.origTitlePx);
  const origBodyPx  = parseFloat(linesEl.dataset.origBodyPx);
  const origGapPx   = parseFloat(linesEl.dataset.origGapPx);

  // Start from originals every time we fit
  let scale  = 1.0;
  let titlePx = origTitlePx;
  let bodyPx  = origBodyPx;
  let gapPx   = origGapPx;

  const apply = () => {
    if (titleEl) titleEl.style.fontSize = `${titlePx}px`;
    linesEl.querySelectorAll('.poem-line.body').forEach(el => el.style.fontSize = `${bodyPx}px`);
    linesEl.style.gap = `${gapPx}px`;
  };
  apply();

  const fits = () => {
    const widest = maxLineWidth(linesEl);
    const tooWide = (widest + EXTRA_X) > availW;
    const tooTall = (linesEl.scrollHeight + EXTRA_Y) > availH;
    return { tooWide, tooTall };
  };

  const minScaleTitle = minTitle / origTitlePx;
  const minScaleBody  = minBody  / origBodyPx;
  const hardFloor     = Math.min(minScaleTitle, minScaleBody);

  let guard = 0;
  while (guard++ < 16) {
    const { tooWide, tooTall } = fits();
    if (!tooWide && !tooTall) {
      container.classList.remove('poem-scroll');
      return;
    }

    const needW = availW / Math.max(1, linesEl.getBoundingClientRect().width + EXTRA_X);
    const needH = availH / Math.max(1, linesEl.scrollHeight + EXTRA_Y);
    let step = Math.min(needW, needH, 0.96);  // never grow (we baseline at full size)

    const nextScale = Math.max(hardFloor, scale * step);
    titlePx = origTitlePx * nextScale;
    bodyPx  = origBodyPx  * nextScale;
    gapPx   = Math.max(4, origGapPx * (0.8 + 0.2 * nextScale));
    apply();
    scale = nextScale;

    if (scale === hardFloor) {
      const { tooWide: w2, tooTall: h2 } = fits();
      if (w2 || h2) {
        container.classList.add('poem-scroll');   // vertical scroll fallback
        container.scrollTop = 0;
      } else {
        container.classList.remove('poem-scroll');
      }
      return;
    }
  }

  container.classList.add('poem-scroll');
  container.scrollTop = 0;
}

class PoemUI {
  constructor() {
    this.canvas = document.getElementById(CANVAS_ID);
    if (!this.canvas) return console.warn('[poem] #water not found');

    this.layers = this.createLayers();
    this.raf = 0;

    this.titlesData = [];
    this.deck = [];
    this.titleEls = new Set();
    this.poemOpen = false;

    this.injectStyles();
    this.init();
  }

  async init() {
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load ${MANIFEST_URL}`);
      const list = await res.json();
      this.titlesData = list.map((p, i) => ({ title: p.title || `Poem ${i+1}`, file: p.file }));
      this.shuffleDeck();
      this.bind();
      this.startRAF();
    } catch (e) {
      console.error('[poem] manifest error:', e);
    }
  }

  updatePoemCenterHeight() {
    const center = this.layers?.poemLayer?.querySelector('.poem-center');
    if (!center) return;
    const vv = window.visualViewport;
    const h = (vv && vv.height) ? vv.height : window.innerHeight;
    center.style.height = h + 'px';
  }

  reflowPoemIfOpen = () => {
    if (!this.poemOpen) return;
    this.updatePoemCenterHeight();
    const box = this.layers?.poemLayer?.querySelector('.poem-lines');
    if (box) {
      resetFitCache(box);
      fitPoemBlock(box);
    }
  };

  createLayers() {
    const titleLayer = document.createElement('div');
    Object.assign(titleLayer.style, { position:'fixed', inset:'0', zIndex:10, pointerEvents:'none' });
    titleLayer.id = 'poem-overlay-titles';
    document.body.appendChild(titleLayer);

    const poemLayer = document.createElement('div');
    poemLayer.id = 'poem-layer';
    Object.assign(poemLayer.style, {
      position:'fixed', inset:'0', zIndex:15, display:'none', pointerEvents:'none'
    });
    poemLayer.innerHTML = `
      <div class="poem-center">
        <div class="poem-lines"></div>
      </div>`;
    document.body.appendChild(poemLayer);

    addEventListener('orientationchange', this.reflowPoemIfOpen);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.reflowPoemIfOpen);
    }

    // Forward taps/clicks on the overlay to the canvas so waves spawn while a poem is open
    let justForwardedTouch = 0;
    const forwardToCanvas = (e) => {
      if (!this.poemOpen) return;
      const now = performance.now();
      if (e.type === 'pointerdown' && now - justForwardedTouch < 60) return;

      let x, y;
      if (e.touches && e.touches[0]) { x = e.touches[0].clientX; y = e.touches[0].clientY; }
      else if (e.changedTouches && e.changedTouches[0]) { x = e.changedTouches[0].clientX; y = e.changedTouches[0].clientY; }
      else { x = e.clientX; y = e.clientY; }

      if (window.PointerEvent) {
        this.canvas.dispatchEvent(new PointerEvent('pointerdown', {
          clientX:x, clientY:y, buttons:1, pointerId:1, pointerType:'touch', bubbles:true, cancelable:true
        }));
      } else {
        this.canvas.dispatchEvent(new MouseEvent('mousedown', { clientX:x, clientY:y, bubbles:true, cancelable:true }));
      }
      if (e.type.startsWith('touch') && e.cancelable) e.preventDefault();
      if (e.type.startsWith('touch')) justForwardedTouch = now;
    };

    poemLayer.addEventListener('pointerdown', forwardToCanvas, true);
    poemLayer.querySelector('.poem-center').addEventListener('pointerdown', forwardToCanvas, true);
    poemLayer.addEventListener('touchstart', forwardToCanvas, { capture:true, passive:false });
    poemLayer.querySelector('.poem-center').addEventListener('touchstart', forwardToCanvas, { capture:true, passive:false });

    // Double-tap anywhere to close poem
    let lastTapTime = 0;
    poemLayer.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTapTime < 300) { e.preventDefault(); this.closePoem(); }
      lastTapTime = now;
    }, { passive:false });

    addEventListener('resize', this.reflowPoemIfOpen);
    addEventListener('keydown', (e)=>{ if (e.key === 'Escape') this.closePoem(); });

    return { titleLayer, poemLayer };
  }

  injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      /* Page-level guard: never show horizontal scrollbar */
      html, body { margin:0; width:100%; overflow-x:hidden; }
      *, *::before, *::after { box-sizing: border-box; }

      /* Title chips */
      .poem-title {
        position:absolute; transform:translate(-50%,-50%);
        font:600 16px/1.25 ui-sans-serif,-apple-system,"Segoe UI",Roboto,
             "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;
        color:#e6edf5; letter-spacing:.2px; text-decoration:none;
        text-shadow:0 1px 0 rgba(0,0,0,.55), 0 0 12px rgba(0,0,0,.35);
        pointer-events:auto; white-space:nowrap; max-width:min(80svw,560px);
        overflow:hidden; text-overflow:ellipsis;
        opacity:0; transition:opacity ${FADE_MS}ms ease;
      }
      .poem-title.show { opacity:1; }

      /* Overlay */
      #poem-layer { background: transparent; }
      .poem-center {
        position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
        width:min(92svw, 900px);

        /* Dynamic viewport sizing */
        height: 100svh;
        max-height: 100svh;

        /* Safe-area padding (iOS) */
        padding-top: env(safe-area-inset-top, 0);
        padding-bottom: env(safe-area-inset-bottom, 0);

        /* Prevent horizontal scrollbar from overlay */
        overflow-x: clip;
        overflow-y: hidden;

        pointer-events:auto;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      .poem-center.poem-scroll {
        overflow-y:auto;
        overflow-x: clip;
        -webkit-overflow-scrolling: touch;
      }

      .poem-lines {
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:${Math.max(10, LINE_GAP - 12)}px;
        padding:0 16px;   /* SAFE_HPAD must match */
        width:100%; height:100%;
      }

      .poem-line {
        text-align:center; color:#e9eef4; text-shadow:0 1px 0 rgba(0,0,0,.5);
        -webkit-text-stroke: 0.8px black; paint-order: stroke fill;
        word-break: break-word; overflow-wrap:anywhere;
      }
      .poem-line.title { font-weight:800; font-size:${TITLE_SIZE}px; letter-spacing:.2px; color:#f2f7ff; }
      .poem-line.body  { font-weight:500; font-size:${BODY_SIZE}px; letter-spacing:.15px; }

      .poem-word { display:inline-block; }
      .poem-char { display:inline-block; will-change: transform, opacity; }
    `;
    document.head.appendChild(s);
  }

  shuffleDeck(){
    this.deck = this.titlesData.slice();
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }
  nextTitle(){ if (!this.deck.length) this.shuffleDeck(); return this.deck.pop(); }

  bind() {
    this.canvas.addEventListener('pointerdown', e => {
      if (this.poemOpen) return;
      const { clientX: vx, clientY: vy } = e;
      const item = this.nextTitle();

      const a = document.createElement('a');
      a.className = 'poem-title';
      a.href = `poem/${item.file}`;
      a.textContent = item.title;
      a.style.left = `${vx}px`;
      a.style.top  = `${vy}px`;
      a.addEventListener('click', ev => { ev.preventDefault(); this.openPoem(item.file); });

      this.layers.titleLayer.appendChild(a);
      this.titleEls.add(a);
      requestAnimationFrame(()=> a.classList.add('show'));

      if (TITLE_LINGER > 0) setTimeout(()=> this.removeTitle(a), TITLE_LINGER);
      if (this.titleEls.size > MAX_TITLES) {
        const first = this.titleEls.values().next().value;
        this.removeTitle(first);
      }
    }, true);
  }

  removeTitle(el){
    if (!el || !this.titleEls.has(el)) return;
    el.classList.remove('show');
    setTimeout(()=>{ if (el.parentNode) el.parentNode.removeChild(el); this.titleEls.delete(el); }, FADE_MS);
  }
  clearTitles(){
    for (const el of this.titleEls) { if (el.parentNode) el.parentNode.removeChild(el); }
    this.titleEls.clear();
  }

  async openPoem(file){
    try{
      const res = await fetch(`poem/${file}`, { cache:'no-store' });
      if (!res.ok) throw new Error(`Failed to load poem/${file}`);
      const txt = await res.text();

      this.clearTitles();

      const lines = txt.split(/\r?\n/);
      const firstIdx = lines.findIndex(s => s.trim().length>0);
      const title = firstIdx >= 0 ? lines[firstIdx].trim() : '(untitled)';
      const body  = lines.slice(firstIdx + 1);

      this.renderPoem(title, body);
      this.layers.poemLayer.style.display = 'block';
      this.poemOpen = true;

      // iOS: set explicit visual height, then reset sizes and fit
      this.updatePoemCenterHeight();
      requestAnimationFrame(() => {
        const box = this.layers.poemLayer.querySelector('.poem-lines');
        resetFitCache(box);     // <<< important: start from baseline each time
        fitPoemBlock(box);
      });
    }catch(e){ console.error('[poem] open error:', e); }
  }

  closePoem(){
    if (!this.poemOpen) return;
    this.layers.poemLayer.style.display = 'none';
    this.layers.poemLayer.querySelector('.poem-lines').innerHTML = '';
    this.poemOpen = false;
  }

  renderPoem(title, body){
    const box = this.layers.poemLayer.querySelector('.poem-lines');
    box.innerHTML = '';

    const t = document.createElement('div');
    t.className = 'poem-line title';
    t.appendChild(this.buildGlyphs(title));
    box.appendChild(t);

    body.forEach(line=>{
      const d = document.createElement('div');
      d.className = 'poem-line body';
      d.appendChild(this.buildGlyphs(line));
      box.appendChild(d);
    });
  }

  buildGlyphs(text){
    const frag = document.createDocumentFragment();
    const parts = (text ?? '').split(/(\s+)/);
    parts.forEach(tok=>{
      if (tok.trim()===''){ frag.appendChild(document.createTextNode(tok)); }
      else{
        const w = document.createElement('span'); w.className='poem-word';
        [...tok].forEach(ch=>{ const c=document.createElement('span'); c.className='poem-char'; c.textContent=ch; w.appendChild(c); });
        frag.appendChild(w);
      }
    });
    return frag;
  }

  sampleH(x,y){
    const sim = window.WATER;
    if (!sim) return 0;
    if (typeof sim.sampleHeightCSS === 'function') return sim.sampleHeightCSS(x,y) || 0;
    return 0;
  }
  sampleSlope(x,y){
    const hL=this.sampleH(x-E,y), hR=this.sampleH(x+E,y), hU=this.sampleH(x,y-E), hD=this.sampleH(x,y+E);
    const sx=(hR-hL)*0.5, sy=(hD-hU)*0.5; const mag=Math.hypot(sx,sy);
    return { sx, sy, mag };
  }

  startRAF(){
    if (this.raf) cancelAnimationFrame(this.raf);
    const step = ()=>{
      const t = performance.now()/1000;

      for (const el of this.titleEls) {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const h = this.sampleH(cx, cy);
        const { sx, sy, mag } = this.sampleSlope(cx, cy);
        const vy = h * FLOAT_GAIN;
        const sway = Math.sin(t*0.8 + (r.left+r.top)*0.02) * SWAY_PX;
        const rotDeg = (-sx * ROT_GAIN) + (Math.sin(t*0.6 + r.top*0.03) * 2);
        let alpha = OPACITY_MIN + Math.min(1, mag * CONTRAST_GAIN);
        if (alpha > 1) alpha = 1;
        el.style.opacity = alpha.toFixed(3);
        const { dx, dy } = clampDisp(el, sway, vy);
        el.style.transform = `translate(-50%, -50%) translateY(${dy}px) translateX(${dx}px) rotate(${rotDeg}deg)`;
      }

      if (this.poemOpen) {
        const box = this.layers.poemLayer.querySelector('.poem-lines');
        const chars = box ? box.querySelectorAll('.poem-char') : [];
        let idx = 0;
        chars.forEach(el=>{
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width/2, cy = r.top + r.height/2;
          const h = this.sampleH(cx, cy);
          const { sx, sy, mag } = this.sampleSlope(cx, cy);
          const vy = h * FLOAT_GAIN;
          const sway = Math.sin(t*0.8 + idx*0.3) * SWAY_PX;
          const rotDeg = (-sx * ROT_GAIN) + (Math.sin(t*0.6 + idx*0.7) * 2);
          let alpha = OPACITY_MIN + Math.min(1, mag * CONTRAST_GAIN);
          if (alpha > 1) alpha = 1;
          const { dx, dy } = clampDisp(el, sway, vy);
          el.style.opacity = alpha.toFixed(3);
          el.style.transform = `translateY(${dy}px) translateX(${dx}px) rotate(${rotDeg}deg)`;
          idx++;
        });
      }

      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

new PoemUI();
