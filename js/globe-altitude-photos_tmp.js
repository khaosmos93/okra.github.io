(() => {
  // --- 1) KEY HANDLING -------------------------------------------------------
  const urlKey = new URLSearchParams(location.search).get("key") || "";
  const KEY = (window.MAPTILER_KEY || urlKey || "").trim();

  const withKey = (url) => {
    if (!KEY) return url.replace("?key={key}", "");
    if (url.includes("{key}")) return url.replace("{key}", KEY);
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(KEY)}`;
  };

  // --- 2) STYLE: GLOBE + SKY + HILLSHADE + WATER + CONTOURS ------------------
  // Hillshade is grayscale; we tune contrast/brightness so low altitudes are darker
  // and high altitudes are brighter/whiter. Water is drawn above hillshade.
  const style = {
    version: 8,
    projection: { name: "globe" }, // enforced again on 'load' for safety
    glyphs: withKey("https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}"),
    sources: {
      omt: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/v3/tiles.json?key={key}")
      },
      hillshade: {
        type: "raster",
        tiles: [ withKey("https://api.maptiler.com/tiles/hillshade/{z}/{x}/{y}.webp?key={key}") ],
        tileSize: 512,
        attribution: "\u00A9 MapTiler \u00A9 OpenStreetMap contributors"
      },
      contours: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/contours/tiles.json?key={key}")
      }
    },
    layers: [
      // background (pure black)
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },

      // hillshade under everything else (grayscale terrain)
      {
        id: "hillshade",
        type: "raster",
        source: "hillshade",
        paint: {
          // high altitude => whiter; low => darker
          "raster-opacity": 1.0,
          "raster-contrast": 0.9,
          "raster-brightness-min": 0.0,
          "raster-brightness-max": 1.35,
          "raster-saturation": 0,
          "raster-hue-rotate": 0
        }
      },

      // oceans & big lakes (deep blue) — sits ABOVE hillshade
      {
        id: "water-fill",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: {
          "fill-color": "#0a2a66",
          "fill-opacity": 1.0
        }
      },

      // rivers
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

      // contours (index + regular)
      {
        id: "contours-index",
        type: "line",
        source: "contours",
        "source-layer": "contour",
        filter: ["==", ["get", "index"], 1],
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.2, 6, 0.5, 10, 0.9, 12, 1.3, 14, 1.7]
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
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.25, 6, 0.5, 10, 0.75, 14, 0.9],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.1, 6, 0.3, 10, 0.6, 12, 0.8, 14, 1.0]
        }
      }
    ]
  };

  // --- 3) MAP INIT -----------------------------------------------------------
  const map = new maplibregl.Map({
    container: "map",
    style,
    center: [0, 20],
    zoom: 1.8,
    hash: true,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  // Keep layer order sane (water above hillshade, etc.)
  function ensureLayerOrder() {
    const order = ['bg', 'hillshade', 'water-fill', 'waterway-line', 'contours-regular', 'contours-index', 'sky'];
    order.forEach((id, i) => {
      if (!map.getLayer(id)) return;
      const before = order.slice(i + 1).find(next => map.getLayer(next));
      try { map.moveLayer(id, before || undefined); } catch (_) {}
    });
  }

  map.on("load", () => {
    // enforce globe (some environments ignore projection in JSON on first paint)
    if (typeof map.setProjection === 'function') {
      try { map.setProjection({ name: 'globe' }); } catch (_) {}
    }

    // add a sky so first frame isn't pure black
    if (!map.getLayer('sky')) {
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'gradient',
          'sky-color': '#02162f',
          'sky-horizon-blend': 0.4,
          'sky-atmosphere-color': '#02162f',
          'sky-atmosphere-sun-intensity': 10
        }
      }); // sky renders behind the world
    }

    ensureLayerOrder();

    // Dark UI for controls
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

    // load photos only from travel/photos.json
    loadTravelPhotosJSON();
  });

  // Helpful message if key missing or blocked
  map.on("error", (e) => {
    const err = e && e.error;
    if (!err || !err.url) return;
    const is403 = /(^|\s)403(\s|$)/.test(String(err.status || err.message || ""));
    const isMapTiler = /api\.maptiler\.com/.test(err.url);
    if (isMapTiler && (is403 || !KEY)) {
      console.warn("MapTiler request blocked or no key. Add ?key=YOUR_KEY or set window.MAPTILER_KEY; and allow your domain in key settings.");
    }
  });

  // --- 4) LOAD PHOTOS ONLY FROM travel/photos.json ---------------------------
  const statusEl = document.getElementById("status");

  async function loadTravelPhotosJSON() {
    try {
      statusEl.hidden = false;
      statusEl.textContent = "Loading photos from travel/photos.json…";

      const res = await fetch("travel/photos.json", { cache: "no-store" });
      if (!res.ok) {
        statusEl.textContent = "No travel/photos.json found (or not accessible).";
        return;
      }
      const list = await res.json();
      if (!Array.isArray(list) || list.length === 0) {
        statusEl.textContent = "travel/photos.json is empty (no filenames).";
        return;
      }

      let placed = 0;
      for (const name of list) {
        if (typeof name !== "string") continue;
        const ok = await readExifAndPlaceFromURL(`travel/${encodeURIComponent(name)}`, name);
        if (ok) placed++;
      }
      statusEl.textContent = placed > 0
        ? `Placed ${placed} photo${placed>1?"s":""} from travel/photos.json.`
        : "No images in travel/photos.json had valid GPS EXIF.";
      setTimeout(() => { statusEl.hidden = true; }, 2500);
    } catch (err) {
      console.error("Failed to load travel/photos.json", err);
      statusEl.textContent = "Error loading travel/photos.json (see console).";
    }
  }

  function dmsToDeg(dms, ref) {
    if (!Array.isArray(dms) || dms.length !== 3) return null;
    const toNum = (v) => (typeof v === "number" ? v : (v.numerator / v.denominator));
    const deg = toNum(dms[0]) + toNum(dms[1]) / 60 + toNum(dms[2]) / 3600;
    return (ref === "S" || ref === "W") ? -deg : deg;
  }

  async function readExifAndPlaceFromURL(url, name) {
    try {
      // ensure EXIF library is present
      if (typeof ExifReader === "undefined") {
        console.warn("ExifReader not loaded; skipping EXIF parse for", url);
        return false;
      }

      const buffer = await fetch(url, { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
        return r.arrayBuffer();
      });
      const tags = ExifReader.load(buffer);

      const lat = tags.GPSLatitude?.description ?? tags.GPSLatitude?.value;
      const latRef = tags.GPSLatitudeRef?.value ?? tags.GPSLatitudeRef?.description;
      const lon = tags.GPSLongitude?.description ?? tags.GPSLongitude?.value;
      const lonRef = tags.GPSLongitudeRef?.value ?? tags.GPSLongitudeRef?.description;

      const latDeg = (typeof lat === "number") ? lat : dmsToDeg(lat, typeof latRef === "string" ? latRef : (latRef && latRef.description));
      const lonDeg = (typeof lon === "number") ? lon : dmsToDeg(lon, typeof lonRef === "string" ? lonRef : (lonRef && lonRef.description));

      if (!isFinite(latDeg) || !isFinite(lonDeg)) {
        console.warn("No valid GPS in:", name || url);
        return false;
      }
      addPhotoMarker(url, name || url.split("/").pop(), lonDeg, latDeg);
      return true;
    } catch (err) {
      console.error("EXIF read failed for", url, err);
      return false;
    }
  }

  function addPhotoMarker(imgURL, label, lon, lat) {
    const el = document.createElement("div");
    el.className = "photo-marker";
    const img = document.createElement("img");
    img.src = imgURL; img.alt = label || "photo";
    el.appendChild(img);

    const popupHTML = `
      <div style="display:flex;gap:8px;align-items:flex-start">
        <img class="popup-img" src="${imgURL}" alt="${label || ""}" />
        <div>
          <div><strong>${label || ""}</strong></div>
          <div>Lat: ${lat.toFixed(5)} Lon: ${lon.toFixed(5)}</div>
        </div>
      </div>
    `;
    const popup = new maplibregl.Popup({ offset: 14 }).setHTML(popupHTML);

    new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(map);

    if (!addPhotoMarker._hasFlown) {
      addPhotoMarker._hasFlown = true;
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 3.2), speed: 0.8 });
    }
  }
})();
