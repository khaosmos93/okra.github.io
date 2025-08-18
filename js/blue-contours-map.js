// js/blue-contours-map.js
(() => {
  // --- KEY helper ------------------------------------------------------------
  const urlKey = new URLSearchParams(location.search).get("key") || "";
  const KEY = (window.MAPTILER_KEY || urlKey || "").trim();
  const withKey = (url) => {
    if (!KEY) return url.replace("?key={key}", "");
    if (url.includes("{key}")) return url.replace("{key}", KEY);
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(KEY)}`;
  };

  // --- STYLE: altitude B/W + water + waterways + contours --------------------
  const style = {
    version: 8,
    projection: { name: "vertical-perspective" },
    glyphs: withKey("https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}"),
    sources: {
      terrainRGB: {
        type: "raster-dem",
        url: withKey("https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key={key}"),
        tileSize: 512
      },
      omt: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/v3/tiles.json?key={key}")
      },
      contours: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/contours/tiles.json?key={key}")
      }
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },
      {
        id: "hillshade",
        type: "hillshade",
        source: "terrainRGB",
        paint: {
          "hillshade-exaggeration": 0.9,
          "hillshade-shadow-color": "#000000",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#9a9a9a"
        }
      },
      {
        id: "water-fill",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: { "fill-color": "#0a2a66", "fill-opacity": 0.95 }
      },
      {
        id: "waterway-line",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        paint: {
          "line-color": "#0f3d99",
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.2, 6, 0.6, 10, 1.2, 14, 2.0],
          "line-opacity": 0.9
        }
      },
      {
        id: "contours-index",
        type: "line",
        source: "contours",
        "source-layer": "contour",
        filter: ["==", ["get", "index"], 1],
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.2, 6, 0.5, 10, 0.9, 12, 1.2, 14, 1.6]
        }
      },
      {
        id: "contours-regular",
        type: "line",
        source: "contours",
        "source-layer": "contour",
        filter: ["!=", ["get", "index"], 1],
        paint: {
          "line-color": "#cfd2d6",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.25, 6, 0.5, 10, 0.8, 14, 0.9],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.1, 6, 0.3, 10, 0.6, 12, 0.8, 14, 1.0]
        }
      }
    ]
  };

  // --- MAP init --------------------------------------------------------------
  const map = new maplibregl.Map({
    container: "map",
    style,
    center: [100, 30],
    zoom: 4.0,
    hash: true,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  map.on("load", () => {
    const css = `
      .maplibregl-ctrl, .maplibregl-ctrl-group {
        background: rgba(15,15,20,0.6);
        backdrop-filter: blur(6px);
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .maplibregl-ctrl button { filter: invert(1) contrast(0.9); }
      .maplibregl-ctrl-attrib { color:#bbb; }
      .maplibregl-ctrl-attrib a { color:#fff; }
    `;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);

    loadTravelPhotos();
  });

  // --- LIGHTBOX + FOURIER wiring --------------------------------------------
  const lightbox = document.getElementById("lightbox");
  const lightImg = document.getElementById("lightbox-img");
  const lightCap = document.getElementById("lightbox-cap");
  const btnPrev  = document.getElementById("btn-prev");
  const btnNext  = document.getElementById("btn-next");
  const btnClose = lightbox ? lightbox.querySelector(".close") : null;

  const btnOutline = document.getElementById('btn-outline-toggle');
  const btnCircles = document.getElementById('btn-circles-toggle');
  const btnOrder   = document.getElementById('btn-order');
  const fourierCanvas = document.getElementById('fourier-canvas');

  let fourierAPI = null;
  let fourierOrder = 20;
  let fourierVisible = true;
  let circlesVisible = true;

  function sizeCanvasToImage() {
    if (!fourierCanvas || !lightImg) return;
    const r = lightImg.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (fourierCanvas.width !== w || fourierCanvas.height !== h) {
      fourierCanvas.width = w;
      fourierCanvas.height = h;
    }
  }

  // --- new helpers (edge → points → DFT) ------------------------------------
  async function extractOutlinePoints(img, {maxPts=600, down=0.5, threshold=40} = {}) {
    const w = Math.max(4, Math.floor(img.naturalWidth  * down));
    const h = Math.max(4, Math.floor(img.naturalHeight * down));
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w*h);
    for (let i=0,j=0; i<data.length; i+=4,j++) {
      gray[j] = (data[i]*0.299 + data[i+1]*0.587 + data[i+2]*0.114)|0;
    }
    const edge = new Uint8ClampedArray(w*h);
    for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
      const i = y*w+x;
      const gx = gray[i+1]-gray[i-1];
      const gy = gray[i+w]-gray[i-w];
      const mag = Math.abs(gx)+Math.abs(gy);
      edge[i] = mag>threshold?255:0;
    }
    const pts=[];
    const step=Math.max(1,Math.floor(Math.sqrt((w*h)/maxPts)));
    for (let y=1;y<h-1;y+=step) for (let x=1;x<w-1;x+=step) {
      if(edge[y*w+x]) pts.push({x,y});
    }
    const cx=w/2, cy=h/2, s=Math.min(w,h);
    return pts.map(p=>({x:(p.x-cx)/s,y:(p.y-cy)/s}));
  }

  function dftCoeffs(points, order=20) {
    if (!points.length) return [];
    const N=points.length;
    const ks=[0]; for(let k=1;k<=order;k++) ks.push(k,-k);
    const coeffs=[];
    for(const k of ks){
      let re=0,im=0;
      for(let n=0;n<N;n++){
        const t=n/N;
        const ang=-2*Math.PI*k*t;
        const xr=points[n].x, xi=points[n].y;
        re += xr*Math.cos(ang) - xi*Math.sin(ang);
        im += xr*Math.sin(ang) + xi*Math.cos(ang);
      }
      re/=N; im/=N;
      coeffs.push({freq:k,re,im});
    }
    coeffs.sort((a,b)=>Math.hypot(b.re,b.im)-Math.hypot(a.re,a.im)||(Math.abs(a.freq)-Math.abs(b.freq)));
    return coeffs;
  }

  async function setupFourier() {
    if (!window.initFourierOutline || !fourierCanvas) return;
    sizeCanvasToImage();
    await lightImg.decode().catch(()=>{});
    let coeffs=[];
    try{
      const pts=await extractOutlinePoints(lightImg);
      if(pts.length>10) coeffs=dftCoeffs(pts,64);
    }catch(e){console.warn("outline extraction failed",e);}
    if(!coeffs.length) coeffs=[{freq:1,amp:1,phase:0}]; // fallback
    fourierAPI=window.initFourierOutline(fourierCanvas,coeffs,{
      order:fourierOrder,
      showCircles:circlesVisible,
      speed:0.3
    });
    fourierCanvas.style.display=fourierVisible?'block':'none';
    if(btnOrder) btnOrder.textContent=`Order: ${fourierOrder}`;
  }

  // UI buttons
  if (btnOutline) btnOutline.addEventListener('click', () => {
    fourierVisible=!fourierVisible;
    fourierCanvas.style.display=fourierVisible?'block':'none';
  });
  if (btnCircles) btnCircles.addEventListener('click', () => {
    circlesVisible=!circlesVisible;
    if(fourierAPI) fourierAPI.setShowCircles(circlesVisible);
  });
  if (btnOrder) btnOrder.addEventListener('click', () => {
    const v=prompt('Set Fourier order (1–200):',String(fourierOrder));
    const n=Math.max(1,Math.min(200,Math.floor(+v||fourierOrder)));
    fourierOrder=n;
    btnOrder.textContent=`Order: ${fourierOrder}`;
    if(fourierAPI) fourierAPI.setOrder(fourierOrder);
  });

  // --- Lightbox core ---------------------------------------------------------
  const photos=[]; let currentIndex=-1;
  function openLightboxAt(i){
    if(!lightbox||i<0||i>=photos.length)return;
    currentIndex=i; const p=photos[i];
    lightImg.onload=()=>{ if(lightCap) lightCap.textContent=''; setupFourier(); };
    lightImg.src=p.url; lightImg.alt='';
    lightbox.classList.add("open");
    preload(i+1); preload(i-1);
  }
  function preload(i){ if(i>=0&&i<photos.length){const im=new Image();im.src=photos[i].url;} }
  function closeLightbox(){ if(!lightbox)return; lightbox.classList.remove("open"); lightImg.src=""; if(lightCap) lightCap.textContent=""; currentIndex=-1; }
  function showNext(){ if(photos.length) openLightboxAt((currentIndex+1)%photos.length); }
  function showPrev(){ if(photos.length) openLightboxAt((currentIndex-1+photos.length)%photos.length); }
  if (btnClose) btnClose.addEventListener("click", closeLightbox);
  if (btnNext)  btnNext.addEventListener("click", showNext);
  if (btnPrev)  btnPrev.addEventListener("click", showPrev);
  if (lightbox) lightbox.addEventListener("click", e => { if (e.target === lightbox) closeLightbox(); });
  addEventListener("keydown", (e) => {
    if (!lightbox || !lightbox.classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") showNext();
    else if (e.key === "ArrowLeft") showPrev();
  });
  addEventListener('resize', () => { if (lightbox && lightbox.classList.contains('open')) sizeCanvasToImage(); });

  // --- PHOTOS: read from travel/photos.json; EXIF if needed ------------------
  const statusEl = document.getElementById("status");
  const showStatus = (msg, hide = 2200) => {
    if (!statusEl) return;
    statusEl.hidden = false; statusEl.textContent = msg;
    if (hide) setTimeout(() => (statusEl.hidden = true), hide);
  };
  const exifrAvailable = !!(window.exifr && typeof exifr.gps === "function");
  const normalizeURL = (src) => {
    if (!src) return null;
    if (/^https?:\/\//i.test(src) || src.startsWith("/")) return src;
    if (!src.startsWith("travel/")) return `travel/${src}`;
    return src;
  };

  async function loadTravelPhotos() {
    try {
      showStatus("Loading photos from travel/photos.json…", 0);
      const res = await fetch("travel/photos.json", { cache: "no-store" });
      if (!res.ok) return showStatus("travel/photos.json not found.");
      const list = await res.json();
      if (!Array.isArray(list) || list.length === 0) return showStatus("travel/photos.json is empty.");

      let placed = 0;
      for (const item of list) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const url = normalizeURL(item.src);
          const lat = Number(item.lat);
          const lon = Number(item.lon);
          if (url && isFinite(lat) && isFinite(lon)) {
            const p = { url, label: url.split("/").pop(), lon, lat };
            addPhotoMarker(p, photos.push(p) - 1);
            placed++;
            continue;
          }
          if (typeof item.src === "string" && exifrAvailable) await tryPlaceViaExif(item.src);
          continue;
        }
        if (typeof item === "string") await tryPlaceViaExif(item);
      }

      if (placed > 0) showStatus(`Placed ${placed} photo${placed > 1 ? "s" : ""}.`);
      else showStatus(exifrAvailable ? "No images had valid GPS EXIF." : "No GPS in JSON and EXIF not loaded.");
    } catch (e) {
      console.error(e);
      showStatus("Error loading photos.json (see console).");
    }
  }

  async function tryPlaceViaExif(name) {
    const url = normalizeURL(name);
    if (!url) return;
    if (!exifrAvailable) return;
    try {
      const gps = await exifr.gps(url);
      if (gps && isFinite(gps.longitude) && isFinite(gps.latitude)) {
        const p = { url, label: name, lon: gps.longitude, lat: gps.latitude };
        addPhotoMarker(p, photos.push(p) - 1);
        return true;
      }
      // fallback: random Antarctica
      const { lon, lat } = randomLngLatAntarctica();
      const p = { url, label: name, lon, lat };
      addPhotoMarker(p, photos.push(p) - 1);
      return true;
    } catch {
      const { lon, lat } = randomLngLatAntarctica();
      const p = { url, label: name, lon, lat };
      addPhotoMarker(p, photos.push(p) - 1);
      return true;
    }
  }

  function randomLngLatAntarctica() {
    const lon = Math.random() * 360 - 180;
    const lat = -60 - Math.random() * 30; // [-90,-60)
    return { lon, lat };
  }

  function addPhotoMarker(photo, index) {
    const img = document.createElement("img");
    img.className = "marker-img";
    img.src = photo.url;
    img.alt = photo.label || "photo";
    img.addEventListener("click", (e) => { e.stopPropagation(); openLightboxAt(index); });

    new maplibregl.Marker({ element: img, anchor: "bottom" })
      .setLngLat([photo.lon, photo.lat])
      .addTo(map);

    // keep default center/zoom; do NOT auto-fly to first photo
    // if (!addPhotoMarker._flown) {
    //   addPhotoMarker._flown = true;
    //   map.flyTo({ center: [photo.lon, photo.lat], zoom: Math.max(map.getZoom(), 3.2), speed: 0.8 });
    // }
  }

  map.on("error", (e) => {
    const err = e && e.error;
    if (!err || !err.url) return;
    const is403 = /(^|\s)403(\s|$)/.test(String(err.status || err.message || ""));
    const isMapTiler = /api\.maptiler\.com/.test(err.url);
    if (isMapTiler && (is403 || !KEY)) {
      console.warn("MapTiler request blocked or key missing. Add ?key=YOUR_KEY or set window.MAPTILER_KEY; ensure your domain is allowed.");
    }
  });
})();
