// js/poem.js — shows poem titles at click points in random order (clickable)
// Loads /poem/poems.json. No libs. MIT.

const CANVAS_ID = 'water';
const MANIFEST_URL = 'poem/poems.json';
const FADE_MS = 600;
const LINGER_MS = 8000;   // 0 = never auto-remove
const MAX_ONSCREEN = 12;

class PoemSpawner {
  constructor() {
    this.canvas = document.getElementById(CANVAS_ID);
    if (!this.canvas) { console.warn('[poem] #water not found'); return; }

    this.overlay = this.ensureOverlay();
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
        href: `poem/${p.file}`
      }));
      this.shuffleDeck();
      this.bind();
    } catch (e) {
      console.error('[poem] manifest error:', e);
    }
  }

  ensureOverlay() {
    const div = document.createElement('div');
    div.id = 'poem-overlay';
    Object.assign(div.style, {
      position: 'fixed', inset: '0', zIndex: '5', pointerEvents: 'none'
    });
    document.body.appendChild(div);
    return div;
  }

  injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      .poem-title {
        position:absolute; transform:translate(-50%,-50%);
        font: 500 16px/1.25 ui-sans-serif, -apple-system, "Segoe UI", Roboto,
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
      @media (prefers-reduced-motion: reduce){ .poem-title{ transition:none; } }
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

  nextPoem() {
    if (this.deck.length === 0) this.shuffleDeck();
    return this.deck.pop();
  }

  bind() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const vx = e.clientX; // viewport coords (overlay is fixed)
      const vy = e.clientY;

      const poem = this.nextPoem();
      const a = document.createElement('a');
      a.className = 'poem-title';
      a.href = poem.href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = poem.title;
      a.style.left = `${vx}px`;
      a.style.top  = `${vy}px`;

      this.overlay.appendChild(a);
      requestAnimationFrame(() => {
        this.keepOnscreen(a);
        a.classList.add('show');
      });

      this.onscreen.add(a);
      if (LINGER_MS > 0) setTimeout(() => this.removeTitle(a), LINGER_MS);
      if (this.onscreen.size > MAX_ONSCREEN) {
        const first = this.onscreen.values().next().value;
        this.removeTitle(first);
      }
    }, true);
  }

  keepOnscreen(el) {
    const pad = 12;
    const r = el.getBoundingClientRect();
    let nx = r.left, ny = r.top;
    if (r.left < pad) nx = pad;
    if (r.right > innerWidth - pad) nx = innerWidth - pad - r.width;
    if (r.top < pad) ny = pad;
    if (r.bottom > innerHeight - pad) ny = innerHeight - pad - r.height;
    if (nx !== r.left || ny !== r.top) {
      el.style.left = `${nx + r.width/2}px`;
      el.style.top  = `${ny + r.height/2}px`;
    }
  }

  removeTitle(el) {
    if (!el || !this.onscreen.has(el)) return;
    el.classList.remove('show');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      this.onscreen.delete(el);
    }, FADE_MS);
  }
}

new PoemSpawner();
