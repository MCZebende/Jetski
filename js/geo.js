const Geo = (() => {
  const NM = 1852;
  const MPS_PER_KT = 0.514444;

  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function haversine(a, b) {
    const R = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
      - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function angleDiff(a, b) {
    return Math.abs(((b - a + 540) % 360) - 180);
  }

  function destination(lat, lon, headingDeg, meters) {
    const R = 6371000;
    const delta = meters / R;
    const theta = toRad(headingDeg);
    const phi1 = toRad(lat);
    const lambda1 = toRad(lon);
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lambda2 = lambda1 + Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );
    return { lat: toDeg(phi2), lon: toDeg(lambda2) };
  }

  function compass(deg) {
    const dirs = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
    const names = ["NORTE", "NORDESTE", "LESTE", "SUDESTE", "SUL", "SUDOESTE", "OESTE", "NOROESTE"];
    const i = Math.round(deg / 45) % 8;
    return { short: dirs[i], name: names[i] };
  }

  function pad(n, size) { return String(n).padStart(size, "0"); }

  function toDms(deg, isLat) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = (mFloat - m) * 60;
    const hem = isLat ? (deg < 0 ? "S" : "N") : (deg < 0 ? "W" : "E");
    return `${pad(d, isLat ? 2 : 3)}°${pad(m, 2)}'${s.toFixed(1)}"${hem}`;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}`;
  }

  function pathLength(points) {
    let sum = 0;
    for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
    return sum;
  }

  function nearestHazard(pos, hazards) {
    let best = null;
    for (const hazard of hazards) {
      const meters = haversine(pos, hazard);
      if (!best || meters < best.meters) best = { hazard, meters };
    }
    return best;
  }

  function segmentHitsHazard(a, b, hazard, extra) {
    const threshold = (hazard.radius || 80) + (extra || 0);
    if (haversine(a, hazard) <= threshold || haversine(b, hazard) <= threshold) return true;
    const midLat = toRad((a.lat + b.lat + hazard.lat) / 3);
    const cosLat = Math.cos(midLat);
    const R = 6371000;
    const ax = toRad(a.lon) * cosLat * R;
    const ay = toRad(a.lat) * R;
    const bx = toRad(b.lon) * cosLat * R;
    const by = toRad(b.lat) * R;
    const hx = toRad(hazard.lon) * cosLat * R;
    const hy = toRad(hazard.lat) * R;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > 0) {
      const t = Math.max(0, Math.min(1, ((hx - ax) * dx + (hy - ay) * dy) / lenSq));
      const projLat = a.lat + (b.lat - a.lat) * t;
      const projLon = a.lon + (b.lon - a.lon) * t;
      if (haversine({ lat: projLat, lon: projLon }, hazard) <= threshold) return true;
    }
    const segM = haversine(a, b);
    const steps = Math.min(400, Math.max(12, Math.ceil(segM / 25)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const p = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      if (haversine(p, hazard) <= threshold) return true;
    }
    return false;
  }

  function buildGpx(points, name) {
    const rows = points.map((pt) => {
      const time = pt.time ? new Date(pt.time).toISOString() : new Date().toISOString();
      const ele = (pt.altitude ?? 0).toFixed(1);
      const spd = pt.knots != null ? `<speed_knots>${Number(pt.knots).toFixed(2)}</speed_knots>` : "";
      const cog = pt.heading != null ? `<course>${Number(pt.heading).toFixed(1)}</course>` : "";
      return `      <trkpt lat="${pt.lat}" lon="${pt.lon}"><ele>${ele}</ele><time>${time}</time><extensions>${spd}${cog}</extensions></trkpt>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="JetSkiNav" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name || "Passeio Jet Ski")}</name>
    <trkseg>
${rows}
    </trkseg>
  </trk>
</gpx>`;
  }

  function buildRouteGpx(waypoints, name) {
    const safeName = escapeXml(name || "Rota Jet Ski");
    const rteRows = waypoints.map((wp, i) => `    <rtept lat="${wp.lat}" lon="${wp.lon}"><name>${escapeXml(wp.name || `WP ${i + 1}`)}</name></rtept>`).join("\n");
    const trkRows = waypoints.map((wp) => `      <trkpt lat="${wp.lat}" lon="${wp.lon}"></trkpt>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="JetSkiNav" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${safeName}</name>
${rteRows}
  </rte>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${trkRows}
    </trkseg>
  </trk>
</gpx>`;
  }

  function buildMultiGpx(trips) {
    const tracks = trips.map((trip) => {
      const rows = (trip.points || []).map((pt) => `      <trkpt lat="${pt.lat}" lon="${pt.lon}"></trkpt>`).join("\n");
      return `  <trk><name>${escapeXml(trip.name)}</name><trkseg>\n${rows}\n    </trkseg></trk>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="JetSkiNav" xmlns="http://www.topografix.com/GPX/1/1">
${tracks}
</gpx>`;
  }

  function parseGpx(xml) {
    const points = [];
    const tagRe = /<(trkpt|rtept|wpt)\b([^>]*)>([\s\S]*?)<\/\1>|<(trkpt|rtept|wpt)\b([^>]*)\/>/gi;
    let match;
    while ((match = tagRe.exec(xml))) {
      const attrs = match[2] || match[5] || "";
      const inner = match[3] || "";
      const latM = /\blat="([^"]+)"/i.exec(attrs);
      const lonM = /\blon="([^"]+)"/i.exec(attrs);
      if (!latM || !lonM) continue;
      const lat = Number(latM[1]);
      const lon = Number(lonM[1]);
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
      const nameM = /<name>([\s\S]*?)<\/name>/i.exec(inner);
      const pt = { lat, lon };
      if (nameM && nameM[1].trim()) pt.name = nameM[1].trim();
      points.push(pt);
    }
    return points;
  }

  function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
    }[c]));
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    NM, MPS_PER_KT, haversine, bearing, angleDiff, destination, compass, toDms,
    formatDuration, pathLength, nearestHazard, segmentHitsHazard,
    buildGpx, buildRouteGpx, buildMultiGpx, parseGpx, download
  };
})();
