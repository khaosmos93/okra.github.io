// Transparent poem UI over water.
// - Title chips float on waves.
// - Clicking a title opens the poem with ONLY text visible (no panel/backdrop).
// - When a poem is shown, all title chips are removed.
// - Letters float/rock like leaves, opacity couples to local wave contrast.
//
// Requires: window.WATER with sampleHeightCSS(x, y).

const CANVAS_ID     = 'water';
const MANIFEST_URL  = 'poem/poems.json';
const FADE_MS       = 400;
const TITLE_LINGER  = 8000;  // 0 => never auto-remove
const MAX_TITLES    = 18;

// Leaf-like motion (shared by titles & poem glyphs)
const FLOAT_GAIN    = 100;   // px per unit height (vertical bob)
const ROT_GAIN      = 50;    // deg per slope unit (rocking)
const SWAY_PX       = 4;     // small horizontal drift
const CONTRAST_GAIN = 3200;  // slope -> opacity gain
const OPACITY_MIN   = 0.35;  // baseline opacity
const E             = 2;     // px offset for slope sampling

// Poem layout
const LINE_GAP      = 34;
const TITLE_SIZE    = 22;
const BODY_SIZE     = 18;

class PoemUI {
  constructor() {
    this.canvas = document.getElementById(CANVAS_ID);
    if (!this.canvas) return console.warn('[poem] #water not found');

    this.layers = this.createLayers();
    this.raf = 0;

    this.titlesData = [];
    this.deck = [];
    this.titleEls = new Set();   // floating title anchors <a>
    this.poemOpen = false;

    this.injectStyles();
    this.init();
  }

  async init() {
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load ${MANIFEST_URL}`);
      const list = await res.json();
      this.titlesData = list.map((p, i) => ({
        title: p.title || `Poem ${i+1}`,
        file:  p.file
      }));
      this.shuffleDeck();
      this.bind();
      this.startRAF(); // float titles (and later glyphs) continuously
    } catch (e) {
      console.error('[poem] manifest error:', e);
    }
  }

  createLayers() {
    // Transparent layer for clickable, floating titles
    const titleLayer = document.createElement('div');
    Object.assign(titleLayer.style, {
      position: 'fixed', inset: '0', zIndex: 10, pointerEvents: 'none'
    });
    titleLayer.id = 'poem-overlay-titles';
    document.body.appendChild(titleLayer);

    // Transparent poem layer (centered text only)
    const poemLayer = document.createElement('div');
    poemLayer.id = 'poem-layer';
    Object.assign(poemLayer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 15,
      display: 'none',        // shown when poem opens
      pointerEvents: 'none',  // text itself doesn't block clicks outside
    });
    poemLayer.innerHTML = `
      <div class="poem-center">
        <div class="poem-lines"></div>
      </div>`;
    document.body.appendChild(poemLayer);

    // Close poem with ESC or click on canvas
    addEventListener('keydown', (e)=>{ if (e.key === 'Escape') this.closePoem(); });
    this.canvas.addEventListener('pointerdown', ()=>{ if (this.poemOpen) this.closePoem(); }, true);

    return { titleLayer, poemLayer };
  }

  injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      /* Transparent title chips: just text (no background/border) */
      .poem-title {
        position:absolute; transform:translate(-50%,-50%);
        font:600 16px/1.25 ui-sans-serif,-apple-system,"Segoe UI",Roboto,
             "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;
        color:#e6edf5; letter-spacing:.2px; text-decoration:none;
        text-shadow:0 1px 0 rgba(0,0,0,.55), 0 0 12px rgba(0,0,0,.35);
        pointer-events:auto; white-space:nowrap; max-width:min(80vw,560px);
        overflow:hidden; text-overflow:ellipsis;
        opacity:0; transition:opacity ${FADE_MS}ms ease;
      }
      .poem-title.show { opacity:1; }

      /* Transparent poem layer (centered perfectly) */
      #poem-layer { background: transparent; }
      .poem-center {
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        width:min(92vw,900px); max-height:80vh; overflow:auto; /* transparent scroll if needed */
        pointer-events:none; /* keep whole layer click-through */
      }
      .poem-lines {
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:${Math.max(10, LINE_GAP - 12)}px;
        padding:0 12px;
      }
      .poem-line { text-align:center; color:#e9eef4; text-shadow:0 1px 0 rgba(0,0,0,.5); }
      .poem-line.title{
        font-weight:800; font-size:${TITLE_SIZE}px; letter-spacing:.2px; color:#f2f7ff;
      }
      .poem-line.body { font-weight:500; font-size:${BODY_SIZE}px; letter-spacing:.15px; }
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
    // Spawn a floating, clickable title at every pointerdown
    this.canvas.addEventListener('pointerdown', e => {
      if (this.poemOpen) return; // ignore clicks while poem shown; clicking closes it
      const { clientX: vx, clientY: vy } = e;
      const item = this.nextTitle();

      const a = document.createElement('a');
      a.className = 'poem-title';
      a.href = `poem/${item.file}`;
      a.textContent = item.title;
      a.style.left = `${vx}px`;
      a.style.top  = `${vy}px`;
      a.addEventListener('click', ev => {
        ev.preventDefault();
        this.openPoem(item.file);
      });

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
    for (const el of this.titleEls) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this.titleEls.clear();
  }

  async openPoem(file){
    try{
      const res = await fetch(`poem/${file}`, { cache:'no-store' });
      if (!res.ok) throw new Error(`Failed to load poem/${file}`);
      const txt = await res.text();

      // Remove all other titles when opening a poem (req #2)
      this.clearTitles();

      const lines = txt.split(/\r?\n/);
      const firstIdx = lines.findIndex(s => s.trim().length>0);
      const title = firstIdx >= 0 ? lines[firstIdx].trim() : '(untitled)';
      const body  = lines.slice(firstIdx + 1);

      this.renderPoem(title, body);
      this.layers.poemLayer.style.display = 'block';
      this.poemOpen = true;
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
    const parts = (text ?? '').split(/(\s+)/); // keep spaces
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

  // --------- Wave sampling helpers ----------
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

  // --------- Unified RAF: float title chips + poem glyphs ----------
  startRAF(){
    if (this.raf) cancelAnimationFrame(this.raf);

    const step = ()=>{
      const t = performance.now()/1000;

      // Float title chips (req #3)
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
        // Titles are absolutely positioned via left/top; we add transform-only motion
        el.style.transform = `translate(-50%, -50%) translateY(${vy.toFixed(2)}px) translateX(${sway.toFixed(2)}px) rotate(${rotDeg.toFixed(2)}deg)`;
      }

      // Float poem glyphs if poem is open (req #1 & #2 already handled)
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

          el.style.opacity = alpha.toFixed(3);
          el.style.transform = `translateY(${vy.toFixed(2)}px) translateX(${sway.toFixed(2)}px) rotate(${rotDeg.toFixed(2)}deg)`;
          idx++;
        });
      }

      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

new PoemUI();
