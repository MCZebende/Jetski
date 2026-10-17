const NauticalMap = (() => {
  const CACHE = "jetskinav-tiles";
  const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const SEA = "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png";

  let map = null;
  let mountedEl = null;
  let vessel = null;
  let accuracyCircle = null;
  let trackLine = null;
  let routeLine = null;
  let seamark = null;
  let extras = null;
  let extrasKey = "";
  let chartLayer = null;
  let chartKey = "";
  let onDrag = null;
  let onTap = null;
  let lastCenter = [-23.0625, -44.2775];
  let lastZoom = 12;
  let lastHeading = 0;

  function vesselIcon(heading, precise) {
    if (heading != null && !Number.isNaN(heading)) lastHeading = heading;
    const fill = precise === false ? "#d97706" : "#0284c7";
    return L.divIcon({
      className: "vessel-icon",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      html: `<div style="transform:rotate(${lastHeading}deg);width:28px;height:28px;display:grid;place-items:center">
        <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:18px solid ${fill};filter:drop-shadow(0 0 0 #0f172a)"></div>
      </div>`
    });
  }

  function createOsmLayer() {
    if (!window.caches) {
      return L.tileLayer(OSM, { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
    }
    const CachedLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement("img");
        L.DomEvent.on(tile, "load", () => {
          if (tile.dataset.objUrl) {
            URL.revokeObjectURL(tile.dataset.objUrl);
            delete tile.dataset.objUrl;
          }
          done(null, tile);
        });
        L.DomEvent.on(tile, "error", (err) => done(err, tile));
        if (this.options.crossOrigin || this.options.crossOrigin === "") {
          tile.crossOrigin = this.options.crossOrigin === true ? "" : this.options.crossOrigin;
        }
        tile.alt = "";
        tile.setAttribute("role", "presentation");
        const url = this.getTileUrl(coords);
        caches.open(CACHE)
          .then((cache) => cache.match(url))
          .then((hit) => (hit ? hit.blob() : null))
          .then((blob) => {
            if (blob) {
              const objUrl = URL.createObjectURL(blob);
              tile.dataset.objUrl = objUrl;
              tile.src = objUrl;
            } else {
              tile.src = url;
            }
          })
          .catch(() => {
            tile.src = url;
          });
        return tile;
      }
    });
    return new CachedLayer(OSM, { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
  }

  function mount(el, onUserDrag, onMapTap) {
    if (!window.L) return false;
    if (map && mountedEl === el) {
      onDrag = onUserDrag || null;
      onTap = onMapTap || null;
      map.invalidateSize();
      return true;
    }
    destroy();
    mountedEl = el;
    onDrag = onUserDrag || null;
    onTap = onMapTap || null;
    map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19 });
    map.setView(lastCenter, lastZoom);
    createOsmLayer().addTo(map);
    seamark = L.tileLayer(SEA, { maxZoom: 18, opacity: 0.95, attribution: "&copy; OpenSeaMap" });
    const chartPane = map.createPane("chart");
    chartPane.style.zIndex = "250";
    extras = L.layerGroup().addTo(map);
    extrasKey = "";
    trackLine = L.polyline([], { color: "#0284c7", weight: 4 }).addTo(map);
    routeLine = L.polyline([], { color: "#0f172a", weight: 3, dashArray: "7 6" }).addTo(map);
    accuracyCircle = L.circle([0, 0], {
      radius: 0,
      color: "#0284c7",
      weight: 1.5,
      dashArray: "4 4",
      fillColor: "#0284c7",
      fillOpacity: 0.1,
      interactive: false
    });
    vessel = L.marker([0, 0], { icon: vesselIcon(lastHeading, true), interactive: false }).addTo(map);
    vessel.setOpacity(0);
    map.on("dragstart", () => { if (onDrag) onDrag(); });
    map.on("click", (ev) => {
      if (onTap && ev && ev.latlng) onTap({ lat: ev.latlng.lat, lon: ev.latlng.lng });
    });
    map.on("moveend zoomend", () => {
      if (!map) return;
      const c = map.getCenter();
      lastCenter = [c.lat, c.lng];
      lastZoom = map.getZoom();
    });
    setTimeout(() => map && map.invalidateSize(), 60);
    return true;
  }

  function update(data) {
    if (!map) return;
    const showSea = !!data.seamarks;
    if (showSea && !map.hasLayer(seamark)) seamark.addTo(map);
    if (!showSea && map.hasLayer(seamark)) map.removeLayer(seamark);

    const chart = data.chart;
    const key = chart ? `${chart.url}|${chart.south}|${chart.west}|${chart.north}|${chart.east}` : "";
    if (key !== chartKey) {
      if (chartLayer) map.removeLayer(chartLayer);
      chartLayer = null;
      chartKey = key;
      if (chart) {
        chartLayer = L.tileLayer(chart.url, {
          pane: "chart",
          minZoom: chart.minZoom || 12,
          maxZoom: 19,
          maxNativeZoom: chart.maxNativeZoom || 16,
          bounds: L.latLngBounds([chart.south, chart.west], [chart.north, chart.east]),
          opacity: 1
        }).addTo(map);
      }
    }
    if (data.frameChart && chart) {
      map.fitBounds([[chart.south, chart.west], [chart.north, chart.east]], { padding: [12, 12] });
    }
    if (data.fitRoute && data.route && data.route.length) {
      if (data.route.length === 1) {
        map.setView([data.route[0].lat, data.route[0].lon], 15);
      } else {
        map.fitBounds(data.route.map((p) => [p.lat, p.lon]), { padding: [24, 24], maxZoom: 16 });
      }
    }

    const track = data.showTrack ? (data.track || []) : [];
    trackLine.setLatLngs(track.map((p) => [p.lat, p.lon]));
    routeLine.setLatLngs((data.route || []).map((p) => [p.lat, p.lon]));

    const nextExtrasKey = JSON.stringify({
      h: (data.hazards || []).map((h) => [h.id, h.name, h.lat, h.lon, h.radius, h.depth]),
      p: (data.pois || []).map((p) => [p.id, p.name, p.lat, p.lon]),
      r: (data.route || []).map((w) => [w.name, w.lat, w.lon]),
      leg: data.leg || 0
    });
    if (nextExtrasKey !== extrasKey) {
      extrasKey = nextExtrasKey;
      extras.clearLayers();
      (data.hazards || []).forEach((hazard) => {
        const radius = hazard.radius || 80;
        const label = `${hazard.name} · Raio ${radius}m${hazard.depth != null ? ` · Prof. ${hazard.depth}m` : ""}`;
        L.circle([hazard.lat, hazard.lon], {
          radius,
          color: "#0f172a",
          weight: 2,
          fillColor: "#d97706",
          fillOpacity: 0.35
        }).bindTooltip(label, { permanent: false }).addTo(extras);
      });
      (data.pois || []).forEach((poi) => {
        L.circleMarker([poi.lat, poi.lon], {
          radius: 6, color: "#0f172a", weight: 2, fillColor: "#0284c7", fillOpacity: 1
        }).bindTooltip(`POI: ${poi.name}`).addTo(extras);
      });
      (data.route || []).forEach((wp, index) => {
        const isTarget = index === Math.min(data.leg || 0, (data.route.length || 1) - 1);
        L.circleMarker([wp.lat, wp.lon], {
          radius: isTarget ? 8 : 7,
          color: "#0f172a",
          weight: 2,
          fillColor: index === data.route.length - 1 ? "#dc2626" : isTarget ? "#0284c7" : "#ffffff",
          fillOpacity: 1
        }).bindTooltip(`${index + 1}. ${wp.name}${isTarget ? " (Em curso)" : ""}`).addTo(extras);
      });
    }

    if (data.pos) {
      const ll = [data.pos.lat, data.pos.lon];
      const acc = data.pos.accuracy || 0;
      const precise = acc <= 40;
      vessel.setLatLng(ll);
      vessel.setOpacity(1);
      vessel.setIcon(vesselIcon(data.pos.heading, precise));
      if (acc > 5) {
        const tone = precise ? "#0284c7" : "#d97706";
        accuracyCircle.setLatLng(ll);
        accuracyCircle.setRadius(Math.min(acc, 600));
        accuracyCircle.setStyle({ color: tone, fillColor: tone });
        if (!map.hasLayer(accuracyCircle)) accuracyCircle.addTo(map);
      } else if (map.hasLayer(accuracyCircle)) {
        map.removeLayer(accuracyCircle);
      }
      if (data.follow && !data.frameChart) {
        if (map.getZoom() < 12) map.setView(ll, 15);
        else map.panTo(ll);
      }
    }
  }

  function destroy() {
    if (map) {
      const c = map.getCenter();
      lastCenter = [c.lat, c.lng];
      lastZoom = map.getZoom();
      map.remove();
    }
    map = null;
    mountedEl = null;
    vessel = null;
    accuracyCircle = null;
    trackLine = null;
    routeLine = null;
    seamark = null;
    extras = null;
    extrasKey = "";
    chartLayer = null;
    chartKey = "";
  }

  function recenter(pos) {
    if (map && pos) map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), 15));
  }

  function focus(lat, lon, zoom) {
    if (map) map.setView([lat, lon], zoom || Math.max(map.getZoom(), 16));
  }

  function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const rad = (lat * Math.PI) / 180;
    const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
    return { x, y, z };
  }

  function tilesAround(lat, lon, radiusM, zooms) {
    const tiles = [];
    zooms.forEach((z) => {
      const center = tileXY(lat, lon, z);
      const meters = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (2 ** z);
      const r = Math.max(1, Math.min(2, Math.ceil(radiusM / meters)));
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) tiles.push({ z, x: center.x + dx, y: center.y + dy });
      }
    });
    return tiles.slice(0, 48);
  }

  async function prefetch(lat, lon, onProgress) {
    if (!window.caches) throw new Error("Este navegador não guarda cartas offline.");
    const tiles = tilesAround(lat, lon, 1600, [14, 15]);
    const cache = await caches.open(CACHE);
    let bytes = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const url = `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
      const hit = await cache.match(url);
      if (!hit) {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Falha ao baixar um tile da carta.");
        const buffer = await response.arrayBuffer();
        bytes += buffer.byteLength;
        await cache.put(url, new Response(buffer, { headers: { "Content-Type": "image/png" } }));
      }
      if (onProgress) onProgress({ done: i + 1, total: tiles.length, bytes });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return { tiles: tiles.length, bytes };
  }

  async function clearCache() {
    if (window.caches) await caches.delete(CACHE);
  }

  async function cacheBytes() {
    if (!window.caches) return 0;
    const keys = await caches.keys();
    if (!keys.includes(CACHE)) return 0;
    const cache = await caches.open(CACHE);
    const requests = await cache.keys();
    let bytes = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (!response) continue;
      const buffer = await response.clone().arrayBuffer();
      bytes += buffer.byteLength;
    }
    return bytes;
  }

  return { mount, update, destroy, recenter, focus, prefetch, clearCache, cacheBytes };
})();
