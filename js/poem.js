// js/poem.js
// Titles at click points; clicking opens a centered overlay.
// First non-empty line in .txt is the title (bigger + bold).
// Letters float & rock like leaves, using water height & slope beneath each glyph.
// Opacity is modulated by local "contrast" (slope magnitude) so text responds to the waves.

const CANVAS_ID     = 'water';
const MANIFEST_URL  = 'poem/poems.json';
const FADE_MS       = 600;
const LINGER_MS     = 8000;    // 0 => never auto-remove title chips
const MAX_ONSCREEN  = 12;

// Floating dynamics (tweak to taste)
const FLOAT_GAIN    = 520;     // px per height unit for vertical bob
const ROT_GAIN      = 22;      // deg per slope unit (rocking amount)
const SWAY_PX       = 4;       // extra horizontal sinusoidal sway
const CONTRAST_GAIN = 3200;    // slope→opacity gain (higher = brighter on contrast)
const OPACITY_MIN   = 0.35;    // baseline opacity where contrast is near zero
const E             = 2;       // CSS px offset for sampling slope

// Layout sizes
const LINE_GAP      = 34;      // px between body lines in modal
const TITLE_SIZE    = 22;      // modal title font size
const BODY_SIZE     = 18;      // modal body font size

class PoemUI {
  constructor() {
    this.canvas = document.getElementById(CANVAS_ID);
    if (!this.canvas) { console.warn('[poem] #water not found'); return; }

    this.layers = this.createLayers();
    this.floatRAF = 0;

    this.titles = [];
    this.deck = [];
    this.onscreen = new Set();

    this.injectStyles();
    this.init();
  }

  async init() {
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load ${MANIFEST_URL}`);
      const list = await res.json();
      this.titles = list.map((p, i) => ({
        title: p.title || `Poem ${i+1}`,
        file:  p.file
      }));
      this.shuffleDeck();
      this.bind();
    } catch (e) {
      console.error('[poem] manifest error:', e);
    }
  }

  createLayers() {
    // Layer for the floating title chips (click points)
    const titleLayer = document.createElement('div');
    Object.assign(titleLayer.style, {
      position: 'fixed', inset: '0', zIndex: 5, pointerEvents: 'none'
    });
    titleLayer.id = 'poem-overlay-titles';
    document.body.appendChild(titleLayer);

    // Modal overlay for the full poem (centered)
    const modal = document.createElement('div');
    modal.id = 'poem-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="poem-modal-backdrop"></div>
      <div class="poem-modal-content" role="dialog" aria-modal="true">
        <button class="poem-close" aria-label="Close">✕</button>
        <div class="poem-lines"></div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('.poem-close')
         .addEventListener('click', () => this.hideModal());
    modal.querySelector('.poem-modal-backdrop')
         .addEventListener('click', () => this.hideModal());
    addEventListener('keydown', e => { if (e.key === 'Escape') this.hideModal(); });

    return { titleLayer, modal };
  }

  injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      .poem-title{
        position:absolute; transform:translate(-50%,-50%);
        font:600 16px/1.25 ui-sans-serif,-apple-system,"Segoe UI",Roboto,
             "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;
        color:#dfe6ee; letter-spacing:.2px; text-decoration:none;
        padding:.35rem .6rem; border-radius:999px;
        background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.08);
        box-shadow:0 4px 24px rgba(0,0,0,.4); pointer-events:auto;
        white-space:nowrap; max-width:min(80vw,560px); overflow:hidden; text-overflow:ellipsis;
        opacity:0; transition:opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
      }
      .poem-title.show{ opacity:1; transform:translate(-50%,-50%) translateY(-2px); }

      #poem-modal{ position:fixed; inset:0; z-index:20; display:none; }
      #poem-modal.open{ display:block; }
      .poem-modal-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.55); }

      .poem-modal-content{
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        width:min(92vw,900px); max-height:80vh; overflow:auto;
        padding:22px 24px 26px; border-radius:18px;
        border:1px solid rgba(255,255,255,.08);
        background:rgba(0,0,0,.35); backdrop-filter:blur(6px);
        box-shadow:0 8px 40px rgba(0,0,0,.6); color:#eaf1f6;
      }

      .poem-close{ position:absolute; top:8px; right:10px; font:700 16px/1 ui-sans-serif;
        color:#cfd8e3; background:transparent; border:0; cursor:pointer; }

      .poem-lines{
        position:relative; width:100%;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:${Math.max(10, LINE_GAP - 12)}px;
        padding:24px 12px;
      }

      .poem-line { text-align:center; color:#e9eef4; text-shadow:0 1px 0 rgba(0,0,0,.4); }
      .poem-line.title{
        font-weight:800; font-size:${TITLE_SIZE}px; letter-spacing:.2px; color:#f2f7ff; margin-bottom:8px;
      }
      .poem-line.body{ font-weight:500; font-size:${BODY_SIZE}px; letter-spacing:.15px; }

      /* Each character wrapped to allow per-glyph floating */
      .poem-word{ display:inline-block; }
      .poem-char{ display:inline-block; will-change: transform, opacity; }
    `;
    document.head.appendChild(s);
  }

  shuffleDeck(){
    this.deck = this.titles.slice();
    for (let i=this.deck.length-1; i>0; i--) {
      const j = Math.floor(Math.random() * (i+1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }
  nextTitle(){ if (!this.deck.length) this.shuffleDeck(); return this.deck.pop(); }

  bind() {
    // Spawn a clickable title at every pointerdown
    this.canvas.addEventListener('pointerdown', e => {
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
      requestAnimationFrame(() => a.classList.add('show'));

      this.onscreen.add(a);
      if (LINGER_MS > 0) setTimeout(() => this.removeTitle(a), LINGER_MS);
      if (this.onscreen.size > MAX_ONSCREEN) {
        const first = this.onscreen.values().next().value;
        this.removeTitle(first);
      }
    }, true);
  }

  removeTitle(el){
    if (!el || !this.onscreen.has(el)) return;
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
      this.onscreen.delete(el);
    }, FADE_MS);
  }

  async openPoem(file) {
    try {
      const res = await fetch(`poem/${file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load poem/${file}`);
      const txt = await res.text();

      const lines = txt.split(/\r?\n/);
      const firstIdx = lines.findIndex(s => s.trim().length > 0);
      const title = firstIdx >= 0 ? lines[firstIdx].trim() : '(untitled)';
      const body  = lines.slice(firstIdx + 1);

      this.renderModal(title, body);
      this.showModal();
      this.startFloating();
    } catch (e) {
      console.error('[poem] open error:', e);
    }
  }

  renderModal(title, body){
    const box = this.layers.modal.querySelector('.poem-lines');
    box.innerHTML = '';

    // Title line (shown prominently)
    const t = document.createElement('div');
    t.className = 'poem-line title';
    t.appendChild(this.buildGlyphs(title));
    box.appendChild(t);

    // Body lines
    body.forEach(line => {
      const d = document.createElement('div');
      d.className = 'poem-line body';
      d.appendChild(this.buildGlyphs(line));
      box.appendChild(d);
    });
  }

  // Create span structure: words -> chars so we can animate per glyph
  buildGlyphs(text) {
    const frag = document.createDocumentFragment();
    const parts = (text ?? '').split(/(\s+)/); // keep spaces as tokens
    parts.forEach(tok => {
      if (tok.trim() === '') {
        frag.appendChild(document.createTextNode(tok)); // preserve whitespace
      } else {
        const w = document.createElement('span');
        w.className = 'poem-word';
        [...tok].forEach(ch => {
          const c = document.createElement('span');
          c.className = 'poem-char';
          c.textContent = ch;
          w.appendChild(c);
        });
        frag.appendChild(w);
      }
    });
    return frag;
  }

  showModal(){
    const m = this.layers.modal;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
  }
  hideModal(){
    const m = this.layers.modal;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    this.stopFloating();
  }

  // Sample water height at (x, y) in CSS pixels
  sampleH(x, y) {
    const sim = window.WATER;
    if (!sim) return 0;
    if (typeof sim.sampleHeightCSS === 'function') {
      return sim.sampleHeightCSS(x, y) || 0;
    }
    return 0;
  }

  // Approximate local slope (contrast) using central differences from height samples
  sampleSlope(x, y) {
    const hL = this.sampleH(x - E, y);
    const hR = this.sampleH(x + E, y);
    const hU = this.sampleH(x, y - E);
    const hD = this.sampleH(x, y + E);
    const sx = (hR - hL) * 0.5;   // ∂h/∂x
    const sy = (hD - hU) * 0.5;   // ∂h/∂y
    const mag = Math.hypot(sx, sy); // slope magnitude as “contrast”
    return { sx, sy, mag };
  }

  startFloating(){
    if (this.floatRAF) cancelAnimationFrame(this.floatRAF);
    const box = this.layers.modal.querySelector('.poem-lines');
    const allChars = () => box.querySelectorAll('.poem-char');

    const step = () => {
      const t = performance.now() / 1000;

      allChars().forEach((el, idx) => {
        const r  = el.getBoundingClientRect();
        const cx = r.left + r.width/2;
        const cy = r.top  + r.height/2;

        const h = this.sampleH(cx, cy);
        const { sx, sy, mag } = this.sampleSlope(cx, cy);

        // Vertical bob from height; small horizontal sway from time
        const vy   = h * FLOAT_GAIN;
        const sway = Math.sin(t * 0.8 + idx * 0.3) * SWAY_PX;

        // “Leaf rock”: rotate proportional to local slope (negative signs for better feel)
        const rotDeg = (-sx * ROT_GAIN) + (Math.sin(t*0.6 + idx*0.7) * 2);

        // Opacity from local contrast + a baseline (clamped 0..1)
        let alpha = OPACITY_MIN + Math.min(1, mag * CONTRAST_GAIN);
        if (alpha > 1) alpha = 1;

        el.style.opacity = alpha.toFixed(3);
        el.style.transform = `translateY(${vy.toFixed(2)}px) translateX(${sway.toFixed(2)}px) rotate(${rotDeg.toFixed(2)}deg)`;
      });

      this.floatRAF = requestAnimationFrame(step);
    };
    this.floatRAF = requestAnimationFrame(step);
  }

  stopFloating(){
    if (this.floatRAF) cancelAnimationFrame(this.floatRAF);
    this.floatRAF = 0;
  }
}

new PoemUI();
