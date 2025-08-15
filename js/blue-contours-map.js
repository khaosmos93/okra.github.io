(() => {
  const KEY = (window.MAPTILER_KEY || "").trim();
  const withKey = (url) => KEY ? url.replace("{key}", KEY) : url.replace("?key={key}", "");

  const style = {
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
      // Background — pure black
      { id: "bg", type: "background", paint: { "background-color": "#000000" } },

      // Water polygons — oceans & lakes
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

      // Waterway lines — rivers
      {
        id: "waterway-line",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        paint: {
          "line-color": "#0f3d99",
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            2, 0.2,
            6, 0.6,
            10, 1.2,
            14, 2.0
          ],
          "line-opacity": 0.9
        }
      },

      // Index contours — bold white
      {
        id: "contours-index",
        type: "line",
        source: "contours",
        "source-layer": "contour",
        filter: ["==", ["get", "index"], 1],
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.9,
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            2, 0.2,
            6, 0.5,
            10, 0.9,
            12, 1.2,
            14, 1.6
          ]
        }
      },

      // Regular contours — thinner gray
      {
        id: "contours-regular",
        type: "line",
        source: "contours",
        "source-layer": "contour",
        filter: ["!=", ["get", "index"], 1],
        paint: {
          "line-color": "#cfd2d6",
          "line-opacity": [
            "interpolate", ["linear"], ["zoom"],
            2, 0.25,
            6, 0.5,
            10, 0.8,
            14, 0.9
          ],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            2, 0.1,
            6, 0.3,
            10, 0.6,
            12, 0.8,
            14, 1.0
          ]
        }
      }
    ]
  };

  const map = new maplibregl.Map({
    container: "map",
    hash: true,
    style,
    center: [0, 20],
    zoom: 1.8,
    projection: { name: "vertical-perspective", center: [0, 20], fov: 3 },
    renderWorldCopies: false,
    attributionControl: false
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

  // Dark UI for controls
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
})();
