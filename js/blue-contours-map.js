(() => {
  // ===== config & helpers =====
  const KEY = (window.MAPTILER_KEY || "").trim();
  const withKey = (url) => KEY ? url.replace("{key}", KEY) : url.replace("?key={key}", "");

  // On‑screen banner (for quick debugging in production)
  const showBanner = (msg) => {
    let el = document.getElementById("map-debug-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "map-debug-banner";
      Object.assign(el.style, {
        position: "fixed",
        left: "12px",
        bottom: "12px",
        zIndex: 9999,
        maxWidth: "min(90vw,600px)",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        padding: "10px 12px",
        borderRadius: "10px",
        font: '12px/1.4 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif',
        boxShadow: "0 6px 24px rgba(0,0,0,0.4)"
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
  };

  // ===== style using MapTiler (vector v3 + contour tiles) =====
  const vectorStyle = {
    version: 8,
    glyphs: withKey("https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}"),
    sources: {
      "omt": {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/v3/tiles.json?key={key}")
      },
      "contours": {
        type: "vector",
        url: withKey("https://api.maptiler.com/tiles/contours/tiles.json?key={key}")
      }
    },
    layers: [
      // black background
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },

      // water polygons (oceans & big lakes) — deep blue
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

      // rivers & waterways — blue lines
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

      // index contours (bold)
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

      // regular contours (thin, grayscale)
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

  // ===== minimal raster fallback (helps avoid pure-black while debugging) =====
  // NOTE: This fallback does NOT draw contours; it just avoids a blank map if KEY is missing.
  const rasterFallbackStyle = {
    version: 8,
    sources: {
      // Simple black background
      bg: { type: "raster", tiles: ["data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="], tileSize: 256 },
      // Public OSM raster (respect usage limits!)
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#000" } },
      { id: "osm", type: "raster", source: "osm", minzoom: 0, maxzoom: 19 }
    ]
  };

  // ===== build map =====
  const map = new maplibregl.Map({
    container: "map",
    hash: true,
    // if we have a key, use vector style (with contours). Otherwise use raster fallback
    style: KEY ? vectorStyle : rasterFallbackStyle,
    center: [0, 20],
    zoom: 1.8,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  // darken controls a bit
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

    if (!KEY) {
      showBanner("MapTiler key is missing → showing raster fallback. Add window.MAPTILER_KEY in map.html to enable deep‑blue water + vector contours.");
    }
  });

  // Surface load errors in a friendly way
  map.on("error", (e) => {
    // Vector style with bad key? Warn and suggest fallback.
    if (KEY) {
      showBanner("Tile/font load error. Check your MapTiler key or network. See console for details.");
      // eslint-disable-next-line no-console
      console.error("[map] error:", e && e.error || e);
    }
  });
})();
