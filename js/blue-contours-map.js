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
    center: [100, 30],   // Asia-centered (lon, lat)
    zoom: 5.5,           // ≈1000km box width
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

  // --- LIGHTBOX with slider --------------------------------------------------
  const lightbox = document.getElementById("lightbox");
  const lightImg = document.getElementById("lightbox-img");
  const lightCap = document.getElementById("lightbox-cap");
  const btnPrev  = document.getElementById("btn-prev");
  const btnNext  = document.getElementById("btn-next");
  const btnClose = lightbox ? lightbox.querySelector(".close") : null;

  const photos = []; // {url,label,lon,lat}
  let currentIndex = -1;

  function openLightboxAt(i) {
    if (!lightbox) return;
    if (i < 0 || i >= photos.length) return;
    currentIndex = i;
    const p = photos[i];
    lightImg.src = p.url;
    lightImg.alt = "";               // ← no filename/label in alt
    lightCap.textContent = "";       // ← hide caption/filename
    lightbox.classList.add("open");
    if (window.FourierOverlay)
      FourierOverlay.show(photos, i);
    preload(i + 1); preload(i - 1);
  }
  function preload(i) {
    if (i < 0 || i >= photos.length) return;
    const img = new Image();
    img.src = photos[i].url;
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove("open");
    lightImg.src = "";
    lightCap.textContent = "";
    currentIndex = -1;
  }
  function showNext() { if (photos.length) openLightboxAt((currentIndex + 1) % photos.length); }
  function showPrev() { if (photos.length) openLightboxAt((currentIndex - 1 + photos.length) % photos.length); }

  if (btnClose) btnClose.addEventListener("click", closeLightbox);
  if (btnNext)  btnNext.addEventListener("click", showNext);
  if (btnPrev)  btnPrev.addEventListener("click", showPrev);
  if (lightbox) {
    lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });
  }
  addEventListener("keydown", (e) => {
    if (!lightbox || !lightbox.classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowRight") showNext();
    else if (e.key === "ArrowLeft") showPrev();
  });

  // --- PHOTOS ---------------------------------------------------------------
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
            const index = photos.push(p) - 1;
            addPhotoMarker(p, index);
            placed++;
            continue;
          }
          if (typeof item.src === "string" && exifrAvailable) await tryPlaceViaExif(item.src);
          continue;
        }
        if (typeof item === "string") await tryPlaceViaExif(item);
      }

      if (placed > 0) showStatus(`Placed ${placed} photo${placed > 1 ? "s" : ""}.`);
      else showStatus(exifrAvailable ? "No images had valid GPS EXIF." : "No GPS in JSON and EXIF library not loaded.");
    } catch (e) {
      console.error(e);
      showStatus("Error loading photos.json (see console).");
    }
  }

  async function tryPlaceViaExif(name) {
    const url = normalizeURL(name);
    if (!url) return;
    if (!exifrAvailable) { console.warn("EXIF not available; skipping", name); return; }
    try {
      const gps = await exifr.gps(url);
      if (gps && isFinite(gps.longitude) && isFinite(gps.latitude)) {
        const p = { url, label: name, lon: gps.longitude, lat: gps.latitude };
        const index = photos.push(p) - 1;
        addPhotoMarker(p, index);
        return true;
      }
      console.warn("No GPS EXIF for", name, "→ placing randomly");
      const { lon, lat } = randomLngLat();
      const p = { url, label: name, lon, lat };
      const index = photos.push(p) - 1;
      addPhotoMarker(p, index);
      return true;
    } catch (err) {
      console.warn("EXIF parse failed for", name, err, "→ placing randomly");
      const { lon, lat } = randomLngLat();
      const p = { url, label: name, lon, lat };
      const index = photos.push(p) - 1;
      addPhotoMarker(p, index);
      return true;
    }
  }

  // Random lon/lat — force Antarctica (lat ∈ [-90, -60))
  function randomLngLat() {
    const lon = Math.random() * 360 - 180;
    const lat = -70 - Math.random() * 15;
    return { lon, lat };
  }

  // --- NEW: tiny thumbnail generator for markers (minimal change) -----------
  async function createThumb(src, size = 40, type = 'image/webp', quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => {
        try {
          const s = size;
          const canvas = document.createElement('canvas');
          canvas.width = s; canvas.height = s;
          const ctx = canvas.getContext('2d', { alpha: false });

          // cover-crop to square
          const iw = img.naturalWidth || img.width;
          const ih = img.naturalHeight || img.height;
          const r = iw / ih;
          let sx = 0, sy = 0, sw = iw, sh = ih;
          if (r > 1) { // wider
            sw = ih * r; sx = (iw - sw) * 0.5;
          } else {     // taller
            sh = iw / r; sy = (ih - sh) * 0.5;
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, s, s);
          resolve(canvas.toDataURL(type, quality));
        } catch (e) { reject(e); }
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function addPhotoMarker(photo, index) {
    const img = document.createElement("img");
    img.className = "marker-img";
    img.alt = "photo";
    img.loading = "lazy";
    img.decoding = "async";

    // ↓↓↓ use small thumbnail instead of full photo (memory saver)
    try {
      img.src = await createThumb(photo.url, 40);  // 40px thumb
    } catch {
      img.src = photo.url; // fallback if canvas fails
    }

    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openLightboxAt(index);
    });

    new maplibregl.Marker({ element: img, anchor: "bottom" })
      .setLngLat([photo.lon, photo.lat])
      .addTo(map);

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
