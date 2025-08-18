// js/fourier-outline.js
(() => {
  /**
   * initFourierOutline(canvas, coeffs, opts)
   * coeffs: [{freq, re, im}] or [{freq, amp, phase}]
   * opts: { order, showCircles, speed, fitScale, center, ui? }
   * - Realtime trace follows the current epicycle tip.
   * - Colors: outline black (#000), circles/arms white (#fff).
   */
  function initFourierOutline(canvas, coeffs, opts = {}) {
    if (!canvas) throw new Error('initFourierOutline: missing canvas');
    const ctx = canvas.getContext('2d', { alpha: true });

    // Normalize coefficients into {freq, amp, phase}
    const normalized = (coeffs || []).map(c => {
      if ('amp' in c && 'phase' in c) return { freq: c.freq|0, amp: +c.amp, phase: +c.phase };
      const amp = Math.hypot(c.re || 0, c.im || 0);
      const phase = Math.atan2(c.im || 0, c.re || 0);
      return { freq: c.freq|0, amp, phase };
    });

    // sort by descending amplitude then by |freq|
    normalized.sort((a,b) => (b.amp - a.amp) || (Math.abs(a.freq) - Math.abs(b.freq)));

    // options
    let order = Math.max(1, Math.floor(+opts.order || 20));
    let showCircles = opts.showCircles !== false;
    const speed = +opts.speed > 0 ? +opts.speed : 0.25; // cycles/sec
    const fitScale = +opts.fitScale > 0 ? +opts.fitScale : 0.9;

    // responsive canvas helpers
    function resizeCanvasToCSSPixels() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvasToCSSPixels();
    addEventListener('resize', resizeCanvasToCSSPixels);

    // center & scale
    function getCenter() {
      const r = canvas.getBoundingClientRect();
      const cx = (opts.center?.[0] ?? r.width / 2);
      const cy = (opts.center?.[1] ?? r.height / 2);
      return { cx, cy };
    }

    // scale so the largest circle fits nicely
    const maxAmp = normalized.length ? normalized[0].amp : 1;
    function toPX(a) {
      const r = canvas.getBoundingClientRect();
      const minDim = Math.min(r.width, r.height);
      return a * (minDim * 0.5 * fitScale) / (maxAmp || 1);
    }

    // trace (rebuilt each cycle; no memory growth)
    let trace = [];
    function resetTrace() { trace = []; }

    // Epicycle endpoint at phase t ∈ [0,1)
    function endpointAt(t, useOrder = order) {
      const { cx, cy } = getCenter();
      let x = cx, y = cy;
      for (let i = 0; i < Math.min(useOrder, normalized.length); i++) {
        const { freq, amp, phase } = normalized[i];
        const ang = 2 * Math.PI * (freq * t) + phase;
        x += Math.cos(ang) * toPX(amp);
        y += Math.sin(ang) * toPX(amp);
      }
      return { x, y };
    }

    // Circles + arms (white)
    function drawEpicycles(t) {
      if (!showCircles) return;
      const { cx, cy } = getCenter();
      let x = cx, y = cy;
      ctx.save();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.95;

      for (let i = 0; i < Math.min(order, normalized.length); i++) {
        const { freq, amp, phase } = normalized[i];
        const R = toPX(amp);

        // circle
        if (R > 0.5) {
          ctx.beginPath();
          ctx.arc(x, y, R, 0, Math.PI * 2);
          ctx.stroke();
        }

        // vector arm
        const ang = 2 * Math.PI * (freq * t) + phase;
        const nx = x + Math.cos(ang) * R;
        const ny = y + Math.sin(ang) * R;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();

        x = nx; y = ny;
      }
      ctx.restore();
    }

    // Realtime trace (black)
    function drawTrace() {
      if (trace.length < 2) return;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(trace[0].x, trace[0].y);
      for (let i = 1; i < trace.length; i++) ctx.lineTo(trace[i].x, trace[i].y);
      ctx.stroke();
      ctx.restore();
    }

    // Animation
    let startTS = 0;
    function frame(ts) {
      if (!startTS) startTS = ts;
      const elapsed = (ts - startTS) / 1000;   // seconds
      const t = (elapsed * speed) % 1;         // phase in [0,1)

      // rebuild trace from 0..t (smooth)
      trace.length = 0;
      const steps = Math.max(60, Math.floor(600 * t));
      for (let i = 0; i <= steps; i++) trace.push(endpointAt(i / Math.max(1, steps)));

      // clear & draw
      const r = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      drawTrace();
      drawEpicycles(t);

      requestAnimationFrame(frame);
    }

    resetTrace();
    requestAnimationFrame(frame);

    return {
      setOrder(n) {
        order = Math.max(1, Math.min(normalized.length || 9999, Math.floor(+n || 1)));
        resetTrace();
      },
      setShowCircles(v) { showCircles = !!v; }
    };
  }

  // expose globally (minimum-change wiring)
  window.initFourierOutline = initFourierOutline;
})();
