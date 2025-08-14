// js/poem.js
// Minimal, dependency-free poem title spawner.
// Loads /poem/poems.json and shows titles at click points in random order.

const CANVAS_ID = 'water';       // canvas to listen on
const MANIFEST_URL = 'poem/poems.json';
const FADE_MS = 600;             // fade-in duration
const LINGER_MS = 8000;          // how long titles remain (0 = never auto-remove)
const MAX_ONSCREEN = 12;         // optional limit to avoid clutter

class PoemSpawner {
  constructor() {
    this.elCanvas = document.getElementById(CANVAS_ID);
    if (!this.elCanvas) return console.warn('[poem] canvas #water not found');

    this.container = this.ensureContainer();
    this.titles = [];
    this.deck = [];
    this.onscreen = new Set();

    this.injectStyles();
    this.loadManifest().then(() => {
      this.shuffleDeck();
      this.bind();
    });
  }

  ensureContainer() {
    // Absolutely positioned overlay for clickable titles
    const div = document.createElement('div');
    div.id = 'poem-overlay';
    Object.assign(div.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none', // let clicks fall through except on links
      zIndex: '5'
    });
    document.body.appendChild(div);
    return div;
  }

  injectStyles() {
    const css = `
    .poem-title {
      position:absolute;
      transform: translate(-50%, -50%);
      font: 500 16px/1.25 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Noto Sans";
      color:#dfe6ee;
      text-decoration:none;
      letter-spacing:.2px;
      padding:.35rem .6rem;
      border-radius:999px;
      background: rgba(0,0,0,.55);
      border:1px solid rgba(255,255,255,.08);
      box-shadow: 0 4px 24px rgba(0,0,0,.4);
      opacity:0;
      pointer-events:auto; /* clickable */
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
      will-change: opacity, transform;
      white-space: nowrap;
      max-width: min(80vw, 560px);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .poem-title.show {
      opacity:1;
      transform: translate(-50%, -50%) translateY(-2px);
    }
    .poem-title:focus,
    .poem-title:hover {
      outline: none;
      background: rgba(10,20,30,.7);
      border-color: rgba(255,255,255,.18);
    }
    @media (prefers-reduced-motion: reduce){
      .poem-title { transition: none; }
    }
    `;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  async loadManifest() {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${MANIFEST_URL}`);
    const list = await res.json();
    // Normalize entries
    this.titles = list.map((p, i) => ({
      title: p.title || `Poem ${i+1}`,
      href:  `poem/${p.file}`,     // link directly to .txt
      slug:  p.slug || p.file.replace(/\.\w+$/, '')
    }));
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
    // Use capturing so we always get the event even if other handlers stop it
    this.elCanvas.addEventListener('pointerdown', (e) => this.spawnAtEvent(e), true);
  }

  spawnAtEvent(e) {
    const rect = this.elCanvas.getBoundingClientRect();
    // Position where user clicked
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Convert to viewport coords for absolute positioning
    const vx = e.clientX;
    const vy = e.clientY;

    const poem = this.nextPoem();
    const a = document.createElement('a');
    a.className = 'poem-title';
    a.href = poem.href;
    a.textContent = poem.title;
    a.setAttribute('data-slug', poem.slug);
    a.target = '_blank';  // open raw text in new tab
    a.rel = 'noopener';

    // Place it
    a.style.left = `${vx}px`;
    a.style.top  = `${vy}px`;

    // Keep titles on screen (nudge if near edges)
    requestAnimationFrame(() => this.keepOnscreen(a));

    this.container.appendChild(a);
    this.onscreen.add(a);

    // Fade in
    requestAnimationFrame(() => a.classList.add('show'));

    // Optional auto-remove to avoid clutter
    if (LINGER_MS > 0) {
      setTimeout(() => this.removeTitle(a), LINGER_MS);
    }
    // Hard cap number on screen
    if (this.onscreen.size > MAX_ONSCREEN) {
      // remove oldest
      const first = this.onscreen.values().next().value;
      this.removeTitle(first);
    }
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
    // wait for fade-out (reuse FADE_MS)
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      this.onscreen.delete(el);
    }, FADE_MS);
  }
}

// bootstrap
new PoemSpawner();
