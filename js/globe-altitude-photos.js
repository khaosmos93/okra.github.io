(() => {
  // --- 0) ENSURE EXIF LIB IS AVAILABLE (fallback loader) ---------------------
  async function ensureExif() {
    if (window.ExifReader) return;
    // if CDN was blocked or slow, try once more
    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/exifreader@4/dist/exif-reader.min.js";
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  // --- 1) KEY HANDLING -------------------------------------------------------
  const urlKey = new URLSearchParams(location.search).get("key") || "";
  const KEY = (window.MAPTILER_KEY || urlKey || "").trim();

  const withKey = (url) => {
    if (!KEY) return url.replace("?key={key}", "");
    if (url.includes("{key}")) return url.replace("{key}", KEY);
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(KEY)}`;
  };

  // --- 2) STYLE: GLOBE + WATER + HILLSHADE + CONTOURS + TERRAIN 3D ----------
  // We add:
  // - projection "globe" in style (and set it again at runtime for older engines)
  // - raster hillshade (grayscale, tuned so high terrain is brighter)
  // - vector contours
  // - raster-dem terrain (terrain-rgb) for true globe + sky
  const style = {
    version: 8,
    projection: { name: "globe" },
    glyphs: withKey("https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}"),
    sources: {
      // OMT vector for water + waterways
      omt: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/v3/tiles.json?key={key}")
      },

      // Hillshade imagery (already grayscale). Make highs look brighter by raising brightness & contrast.
      hillshade: {
        type: "raster",
        tiles: [ withKey("https://api.maptiler.com/tiles/hillshade/{z}/{x}/{y}.webp?key={key}") ],
        tileSize: 512,
        attribution: "\u00A9 MapTiler \u00A9 OpenStreetMap contributors"
      },

      // Contour vectors
      contours: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/contours/tiles.json?key={key}")
      },

      // Elevation for terrain (MapTiler terrain-rgb)
      terrain: {
        type: "raster-dem",
        url: withKey("https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key={key}"),
        tileSize: 512
      }
    },
    layers: [
      // Background
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },

      // Sky (looks good with globe + terrain)
      {
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun-intensity": 10
        }
      },

      // Hillshade under the water
      {
        id: "hillshade",
        type: "raster",
        source: "hillshade",
        paint: {
          // make relief strong and bright in highlands
          "raster-opacity": 1.0,
          "raster-contrast": 0.6,
          "raster-brightness-min": 0.05,
          "raster-brightness-max": 1.0,
          "raster-saturation": 0
        }
      },

      // Water polygons (deep blue)
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

      // Rivers
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

      // Contours (index + regular)
      {
        id: "contours-index",
        type: "line",
        source: "contours",
        "source-layer": "contour",
        filter: ["==", ["get", "index"], 1],
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.25, 6, 0.55, 10, 1.0, 12, 1.4, 14, 1.8]
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
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 6, 0.55, 10, 0.8, 14, 0.9],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.12, 6, 0.35, 10, 0.65, 12, 0.85, 14, 1.05]
        }
      }
    ],
    // Attach terrain in the style for engines that read it directly
    terrain: { source: "terrain", exaggeration: 1.2 }
  };

  // --- 3) MAP INIT -----------------------------------------------------------
  const map = new maplibregl.Map({
    container: "map",
    style,
    center: [0, 20],
    zoom: 1.8,
    hash: true,
    attributionControl: false,
    antialias: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  map.on("load", () => {
    // For MapLibre builds that ignore style.projection/terrain, set them imperatively.
    try { if (map.setProjection) map.setProjection({ name: "globe" }); } catch {}
    try { if (map.setTerrain)    map.setTerrain({ source: "terrain", exaggeration: 1.2 }); } catch {}

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

    // Only load photos from travel/photos.json
    loadTravelPhotosJSON();
  });

  // Helpful message if key missing or blocked
  map.on("error", (e) => {
    const err = e && e.error;
    if (!err || !err.url) return;
    const is403 = /(^|\s)403(\s|$)/.test(String(err.status || err.message || ""));
    const isMapTiler = /api\.maptiler\.com/.test(err.url);
    if (isMapTiler && (is403 || !KEY)) {
      console.warn("MapTiler request blocked or no key. Add ?key=YOUR_KEY or set window.MAPTILER_KEY; and allow your GitHub Pages domain in key settings.");
    }
  });

  // --- 4) LOAD PHOTOS ONLY FROM travel/photos.json ---------------------------
  const statusEl = document.getElementById("status");

  async function loadTravelPhotosJSON() {
    try {
      await ensureExif(); // make sure window.ExifReader exists

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
        // Same-origin image URL (GitHub Pages): ensure path matches your repo structure
        // Avoid double-encoding if your JSON already includes subfolders.
        const url = `travel/${name}`;
        // try/catch per entry to keep going if one fails
        try {
          const ok = await readExifAndPlaceFromURL(url, name);
          if (ok) placed++;
        } catch {}
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
      const buffer = await fetch(url, { cache: "no-store" }).then(r => r.arrayBuffer());
      const tags = ExifReader.load(buffer); // global from UMD

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
