(() => {
  const KEY = (window.MAPTILER_KEY || "").trim();
  const withKey = (url) =>
    KEY ? url.replace("{key}", KEY) : url.replace("?key={key}", "");

  // Style with black–white altitude shading + rivers/lakes
  const style = {
    version: 8,
    projection: { name: "vertical-perspective" },
    glyphs: withKey(
      "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key={key}"
    ),
    sources: {
      terrainRGB: {
        type: "raster-dem",
        url: withKey(
          "https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key={key}"
        ),
        tileSize: 512
      },
      water: {
        type: "vector",
        url: withKey(
          "https://api.maptiler.com/tiles/v3/tiles.json?key={key}"
        )
      }
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#000" } },

      // DEM hillshade with grayscale
      {
        id: "hillshade",
        type: "hillshade",
        source: "terrainRGB",
        paint: {
          "hillshade-shadow-color": "#000000",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#888888",
          "hillshade-exaggeration": 0.8
        }
      },

      // water fill
      {
        id: "water-fill",
        type: "fill",
        source: "water",
        "source-layer": "water",
        paint: { "fill-color": "#0a2a66", "fill-opacity": 0.8 }
      },

      // rivers
      {
        id: "waterway-line",
        type: "line",
        source: "water",
        "source-layer": "waterway",
        paint: {
          "line-color": "#0f3d99",
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.2, 14, 2.0],
          "line-opacity": 0.9
        }
      }
    ]
  };

  const map = new maplibregl.Map({
    container: "map",
    hash: true,
    style,
    center: [0, 20],
    zoom: 1.5,
    attributionControl: false
  });

  map.addControl(
    new maplibregl.NavigationControl({ visualizePitch: true }),
    "top-right"
  );
  map.addControl(
    new maplibregl.ScaleControl({ unit: "metric" }),
    "bottom-left"
  );
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
    "bottom-right"
  );

  // Dark UI tweaks
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

  async function loadTravelPhotos() {
    // List images in /travel manually or via JSON
    const images = await fetch("travel/photos.json").then(r => r.json());

    for (const imgPath of images) {
      try {
        const url = `travel/${imgPath}`;
        const exif = await exifr.gps(url);
        if (exif && exif.longitude && exif.latitude) {
          addPhotoMarker(url, exif.longitude, exif.latitude);
        }
      } catch (err) {
        console.warn("No GPS for", imgPath, err);
      }
    }
  }

  function addPhotoMarker(url, lon, lat) {
    const el = document.createElement("img");
    el.src = url;
    el.className = "marker-img";

    new maplibregl.Marker({ element: el })
      .setLngLat([lon, lat])
      .addTo(map);
  }
})();
