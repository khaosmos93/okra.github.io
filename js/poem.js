// js/poem.js
// Floating poem titles and an overlay that shows the full poem on top of the water.
// - Titles appear at click points, in random order, clickable.
// - Clicking a title opens an overlay; first line = title (larger + bold).
// - Lines float by sampling the water height via window.WATER.sampleHeightCSS().

const CANVAS_ID     = 'water';
const MANIFEST_URL  = 'poem/poems.json';
const FADE_MS       = 600;
const LINGER_MS     = 8000;   // 0 => never auto-remove
const MAX_ONSCREEN  = 12;

// Floating amplitude (pixels) = waterHeight * FLOAT_GAIN
const FLOAT_GAIN    = 520;    // 400–700 feels good depending on your water settings
const LINE_GAP      = 34;     // px between poem lines (body)
const TITLE_SIZE    = 22;     // px (title line in overlay)
const BODY_SIZE     = 18;     // px (body lines in overlay)

class PoemUI {
  constructor() {
    this.canvas = document.getElementById(CANVAS_ID);
    if (!this.canvas) { console.warn('[poem] canvas #water not found'); return; }

    this.overlayRoot = this.ensureOverlayRoot();
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

  ensureOverlayRoot() {
    // 1) Titles overlay (clickable pills)
    const titleLayer = document.createElement('div');
    Object.assign(titleLayer.style, {
      position: 'fixed', inset: '0', zIndex: 5, pointerEvents: 'none'
    });
    titleLayer.id = 'poem-overlay-titles';
    document.body.appendChild(titleLayer);

    // 2) Poem modal overlay (full poem)
    const modal = document.createElement('div');
    modal.id = 'poem-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="poem-modal-backdrop"></div>
      <div class="poem-modal-content" role="dialog" aria-modal="true">
        <button class="poem-close" aria-label="Close">✕</button>
        <div class="poem-lines"></div>
      </div>
    `;
    document.body.appendChild(modal);

    // close handlers
    modal.querySelector('.poem-close').addEventListener('click', () => this.hideModal());
    modal.querySelector('.poem-modal-backdrop').addEventListener('click', () => this.hideModal());
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hideModal(); });

    return { titleLayer, modal };
  }

  injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      /* clickable titles at click points */
      .poem-title {
        position:absolute; transform:translate(-50%,-50%);
        font: 600 16px/1.25 ui-sans-serif, -apple-system, "Segoe UI", Roboto,
              "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
        color:#dfe6ee; text-decoration:none; letter-spacing:.2px;
        padding:.35rem .6rem; border-radius:999px;
        background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.08);
        box-shadow:0 4px 24px rgba(0,0,0,.4);
        opacity:0; transition:opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
        pointer-events:auto; white-space:nowrap; max-width:min(80vw,560px);
        overflow:hidden; text-overflow:ellipsis;
      }
      .poem-title.show { opacity:1; transform:translate(-50%,-50%) translateY(-2px); }

      /* modal overlay */
      #poem-modal { position:fixed; inset:0; z-index: 20; display:none; }
      #poem-modal.open { display:block; }
      .poem-modal-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.55); }
      .poem-modal-content {
        position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        width:min(92vw, 900px); max-height: 80vh; overflow:hidden;
        padding: 22px 24px 26px;
        border-radius: 18px;
        border:1px solid rgba(255,255,255,.08);
        background: rgba(0,0,0,.35); backdrop-filter: blur(6px);
        box-shadow: 0 8px 40px rgba(0,0,0,.6);
        color:#eaf1f6;
      }
      .poem-close {
        position:absolute; top:8px; right:10px; font:700 16px/1 ui-sans-serif;
        color:#cfd8e3; background:transparent; border:0; cursor:pointer;
      }
      .poem-lines { position:relative; width:100%; height: calc(70vh); overflow:hidden; }

      /* individual lines inside modal */
      .poem-line {
        position:absolute; left:50%; transform:translateX(-50%);
        width: 90%;
        text-align:center;
        color:#e9eef4;
        text-shadow: 0 1px 0 rgba(0,0,0,.4);
        white-space: pre-wrap; word-break: break-word;
      }
      .poem-line.title {
        font-weight: 800; font-size: ${TITLE_SIZE}px;
        letter-spacing: .2px; color:#f2f7ff;
      }
      .poem-line.body {
        font-weight: 500; font-size: ${BODY_SIZE}px;
        letter-spacing: .15px;
      }

      @media (prefers-reduced-motion: reduce){
        .poem-title{ transition:none; }
      }
    `;
    document.head.appendChild(s);
  }

  shuffleDeck() {
    this.deck = this.titles.slice();
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }
  nextTitle() {
    if (this.deck.length === 0) this.shuffleDeck();
    return this.deck.pop();
  }

  bind() {
    // spawn a clickable title at every pointerdown
    this.canvas.addEventListener('pointerdown', (e) => {
      const { clientX: vx, clientY: vy } = e;

      const item = this.nextTitle();
      const a = document.createElement('a');
      a.className = 'poem-title';
      a.href = `poem/${item.file}`;
      a.textContent = item.title;
      a.style.left = `${vx}px`;
      a.style.top  = `${vy}px`;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        this.openPoem(item.file);
      });

      this.overlayRoot.titleLayer.appendChild(a);
      requestAnimationFrame(() => a.classList.add('show'));

      this.onscreen.add(a);
      if (LINGER_MS > 0) setTimeout(() => this.removeTitle(a), LINGER_MS);
      if (this.onscreen.size > MAX_ONSCREEN) {
        const first = this.onscreen.values().next().value;
        this.removeTitle(first);
      }
    }, true);
  }

  removeTitle(el) {
    if (!el || !this.onscreen.has(el)) return;
    el.classList.remove('show');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      this.onscreen.delete(el);
    }, FADE_MS);
  }

  /* ---------------- Full poem modal ---------------- */
  async openPoem(file) {
    try {
      const res = await fetch(`poem/${file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load poem/${file}`);
      const txt = await res.text();

      const lines = txt.split(/\r?\n/).map(s => s.trim());
      // first non-empty = title
      const titleIdx = lines.findIndex(s => s.length > 0);
      const title = titleIdx >= 0 ? lines[titleIdx] : '(untitled)';
      const body = lines.slice(titleIdx + 1); // keep empties to preserve spacing feeling if you want

      this.renderModal(title, body);
      this.showModal();
      this.startFloating();
    } catch (e) {
      console.error('[poem] open error:', e);
    }
  }

  renderModal(title, body) {
    const box = this.overlayRoot.modal.querySelector('.poem-lines');
    box.innerHTML = '';

    // Layout: vertical stack centered in the box; each is absolutely positioned so we can float independently
    const centerY = box.clientHeight / 2;
    const startY = centerY - (body.length * LINE_GAP) / 2 - LINE_GAP; // leave room for title above

    // Title line
    const t = document.createElement('div');
    t.className = 'poem-line title';
    t.textContent = title;
    t.style.top = `${startY}px`;
    box.appendChild(t);

    // Body lines
    body.forEach((line, i) => {
      const d = document.createElement('div');
      d.className = 'poem-line body';
      d.textContent = line.length ? line : ' '; // preserve empty line height
      d.style.top = `${startY + (i+1) * LINE_GAP}px`;
      box.appendChild(d);
    });
  }

  showModal() {
    const m = this.overlayRoot.modal;
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
  }
  hideModal() {
    const m = this.overlayRoot.modal;
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    this.stopFloating();
  }

  /* --------------- Floating animation --------------- */
  startFloating() {
    if (this.floatRAF) cancelAnimationFrame(this.floatRAF);
    const box = this.overlayRoot.modal.querySelector('.poem-lines');

    const step = () => {
      const sim = window.WATER;
      const rect = box.getBoundingClientRect();

      // Move each line by sampling the water height at its center
      box.querySelectorAll('.poem-line').forEach((el, idx) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height/ 2;

        let h = 0;
        if (sim && typeof sim.sampleHeightCSS === 'function') {
          h = sim.sampleHeightCSS(cx, cy);
        } else if (sim && sim.h && sim.gw) {
          // Fallback direct read if method missing
          const gx = Math.max(1, Math.min(sim.gw-2,
                    Math.floor(cx / (sim.cvs.width / sim.DPR)  * sim.gw)));
          const gy = Math.max(1, Math.min(sim.gh-2,
                    Math.floor(cy / (sim.cvs.height / sim.DPR) * sim.gh)));
          h = sim.h[gy * sim.gw + gx] || 0;
        }

        // Translate vertically by water height, small horizontal sway for variety
        const vy = h * FLOAT_GAIN;
        const sway = Math.sin((performance.now()/1000) * 0.6 + idx * 0.7) * 4;
        el.style.transform = `translate(-50%, ${vy.toFixed(2)}px) translateX(${sway.toFixed(2)}px)`;
      });

      this.floatRAF = requestAnimationFrame(step);
    };
    this.floatRAF = requestAnimationFrame(step);
  }
  stopFloating() {
    if (this.floatRAF) cancelAnimationFrame(this.floatRAF);
    this.floatRAF = 0;
  }
}

new PoemUI();
