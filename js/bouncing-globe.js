(() => {
  const MAP_URL = "map.html"; // change if you want a full URL

  // create a full-viewport transparent canvas overlay
  const cvs = document.createElement("canvas");
  cvs.id = "bouncing-globe";
  Object.assign(cvs.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "auto",
    background: "transparent",
    zIndex: 50 // put it above your background but below any menus if needed
  });
  document.body.appendChild(cvs);
  const ctx = cvs.getContext("2d");

  // retina sizing
  function resize() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const wcss = window.innerWidth;
    const hcss = window.innerHeight;
    cvs.width = Math.floor(wcss * dpr);
    cvs.height = Math.floor(hcss * dpr);
    cvs._wcss = wcss; // store css px for hit tests
    cvs._hcss = hcss;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  }
  resize();
  addEventListener("resize", resize, { passive: true });

  // globe state
  let r = Math.max(72, Math.min(160, Math.floor(Math.min(cvs._wcss, cvs._hcss) * 0.12)));
  let x = r + 24;
  let y = r + 24;
  let vx = 0.9; // px per frame
  let vy = 0.7;
  let rot = 0;  // radians

  // update radius if screen changes a lot
  function updateRadius() {
    const target = Math.max(72, Math.min(160, Math.floor(Math.min(cvs._wcss, cvs._hcss) * 0.12)));
    r += (target - r) * 0.1;
  }

  // draw a simple white wireframe globe: outer circle, a few parallels + meridians
  function drawGlobe(cx, cy, radius, rotation) {
    ctx.save();

    // shadow for a tiny depth hint (optional)
    ctx.beginPath();
    ctx.arc(cx + radius * 0.06, cy + radius * 0.06, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // outer circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // parallels (latitudes)
    ctx.save();
    ctx.translate(cx, cy);
    const latDeg = [-60, -30, 0, 30, 60];
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    for (const lat of latDeg) {
      const y = radius * Math.sin((lat * Math.PI) / 180);
      const rx = radius * Math.cos((lat * Math.PI) / 180);
      ctx.save();
      ctx.translate(0, y);
      ctx.scale(rx / radius, 1);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // meridians (longitudes) — rotate to simulate spin
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    const lonDeg = [-60, -30, 0, 30, 60, 90, -90];
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    for (const lon of lonDeg) {
      // draw an ellipse that approximates a meridian
      const sy = Math.cos((lon * Math.PI) / 180);
      ctx.save();
      ctx.scale(1, sy);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    ctx.restore();
  }

  // animation loop
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(32, now - last);
    last = now;

    // clear
    ctx.clearRect(0, 0, cvs._wcss, cvs._hcss);

    // update motion
    updateRadius();
    x += vx * (dt / 16);
    y += vy * (dt / 16);
    rot += 0.005 * (dt / 16);

    // bounce off edges
    if (x - r < 0) { x = r; vx = Math.abs(vx); }
    if (x + r > cvs._wcss) { x = cvs._wcss - r; vx = -Math.abs(vx); }
    if (y - r < 0) { y = r; vy = Math.abs(vy); }
    if (y + r > cvs._hcss) { y = cvs._hcss - r; vy = -Math.abs(vy); }

    // draw
    drawGlobe(x, y, r, rot);

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // click → if inside globe, go to map
  cvs.addEventListener("click", (e) => {
    const rect = cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - x;
    const dy = my - y;
    if (dx * dx + dy * dy <= r * r) {
      window.location.href = MAP_URL;
    }
  });

  // optional: cursor hint when hovering globe
  cvs.addEventListener("mousemove", (e) => {
    const rect = cvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - x;
    const dy = my - y;
    cvs.style.cursor = (dx * dx + dy * dy <= r * r) ? "pointer" : "default";
  });
})();
