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

  // --- 2) STYLE: GLOBE + WATER + HILLSHADE + (optional) CONTOURS -------------
  // Uses MapTiler:
  // - Vector OMT v3 (water, waterway)         -> requires key
  // - Raster hillshade (grayscale elevation)  -> requires key
  // Optional: vector contours (commented IN by default)
  const style = {
    version: 8,
    projection: {
      // name: "globe"
      name: "lambertAzimuthalEqualArea"
    },
    glyphs: withKey("https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}"),
    sources: {
      omt: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/v3/tiles.json?key={key}")
      },
      // Pre-rendered grayscale hillshade tiles (WebP 512px)
      hillshade: {
        type: "raster",
        tiles: [
          withKey("https://api.maptiler.com/tiles/hillshade/{z}/{x}/{y}.webp?key={key}")
        ],
        tileSize: 512,
        attribution: "\u00A9 MapTiler \u00A9 OpenStreetMap contributors"
      },
      contours: {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/contours/tiles.json?key={key}")
      }
    },
    layers: [
      // Background
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },

      // Hillshade underneath water (grayscale altitude)
      {
        id: "hillshade",
        type: "raster",
        source: "hillshade",
        paint: {
          "raster-opacity": 0.95,
          "raster-contrast": 0.1,
          "raster-brightness-min": 0.0,
          "raster-brightness-max": 1.0
        }
      },

      // Oceans & big lakes
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

      // Contours (optional but enabled here)
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

  // Darken UI buttons
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
  });

  // Helpful message if key missing or blocked
  map.on("error", (e) => {
    const err = e && e.error;
    if (!err || !err.url) return;
    const is403 = /(^|\s)403(\s|$)/.test(String(err.status || err.message || ""));
    const isMapTiler = /api\.maptiler\.com/.test(err.url);
    if (isMapTiler && (is403 || !KEY)) {
      console.warn("MapTiler request blocked or no key. Add ?key=YOUR_KEY or set window.MAPTILER_KEY; allow your domain in key settings.");
    }
  });

  // --- 4) PHOTOS FROM EXIF GPS ----------------------------------------------
  // Drag-and-drop and file input; for each image we extract GPS and place a marker.
  const inputEl = document.getElementById("photo-input");
  const dropHint = document.getElementById("drop-hint");

  function dmsToDeg(dms, ref) {
    // dms: array of {numerator, denominator} or simple numbers (ExifReader already resolves)
    if (!Array.isArray(dms) || dms.length !== 3) return null;
    const toNum = (v) => (typeof v === "number" ? v : (v.numerator / v.denominator));
    const deg = toNum(dms[0]) + toNum(dms[1]) / 60 + toNum(dms[2]) / 3600;
    return (ref === "S" || ref === "W") ? -deg : deg;
    }

  async function readExifAndPlace(file) {
    try {
      const buffer = await file.arrayBuffer();
      const tags = ExifReader.load(buffer);
      const lat = tags.GPSLatitude && tags.GPSLatitude.description
        ? tags.GPSLatitude.description
        : tags.GPSLatitude && tags.GPSLatitude.value;
      const latRef = tags.GPSLatitudeRef && (tags.GPSLatitudeRef.value || tags.GPSLatitudeRef.description);
      const lon = tags.GPSLongitude && tags.GPSLongitude.description
        ? tags.GPSLongitude.description
        : tags.GPSLongitude && tags.GPSLongitude.value;
      const lonRef = tags.GPSLongitudeRef && (tags.GPSLongitudeRef.value || tags.GPSLongitudeRef.description);

      let latDeg = null, lonDeg = null;

      // ExifReader commonly gives numeric arrays already in degrees — handle both.
      if (typeof lat === "number" && typeof lon === "number") {
        latDeg = lat; lonDeg = lon;
      } else {
        latDeg = dmsToDeg(lat, typeof latRef === "string" ? latRef : (latRef && latRef.description));
        lonDeg = dmsToDeg(lon, typeof lonRef === "string" ? lonRef : (lonRef && lonRef.description));
      }

      if (typeof latDeg !== "number" || typeof lonDeg !== "number" || isNaN(latDeg) || isNaN(lonDeg)) {
        console.warn("No valid GPS in:", file.name);
        return;
      }

      // Build a small preview URL (object URL)
      const imgURL = URL.createObjectURL(file);

      // Marker element
      const el = document.createElement("div");
      el.className = "photo-marker";
      const img = document.createElement("img");
      img.src = imgURL;
      img.alt = file.name;
      el.appendChild(img);

      // Popup
      const popup = new maplibregl.Popup({ offset: 14 }).setHTML(
        `<div style="display:flex;gap:8px;align-items:flex-start">
          <img class="popup-img" src="${imgURL}" alt="${file.name}"/>
          <div>
            <div><strong>${file.name}</strong></div>
            <div>Lat: ${latDeg.toFixed(5)} Lon: ${lonDeg.toFixed(5)}</div>
          </div>
        </div>`
      );

      new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([lonDeg, latDeg])
        .setPopup(popup)
        .addTo(map);

      // On first photo, fly to location a bit
      if (!readExifAndPlace._hasFlown) {
        readExifAndPlace._hasFlown = true;
        map.flyTo({ center: [lonDeg, latDeg], zoom: Math.max(map.getZoom(), 3.2), speed: 0.8 });
      }
    } catch (err) {
      console.error("EXIF read failed", err);
    }
  }

  inputEl.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(readExifAndPlace);
  });

  // Drag & drop support
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropHint.classList.add("show");
  });
  document.addEventListener("dragleave", (e) => {
    if (e.target === document || e.target === document.body) dropHint.classList.remove("show");
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dropHint.classList.remove("show");
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith("image/"));
    files.forEach(readExifAndPlace);
  });
})();
