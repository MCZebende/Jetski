const App = (() => {
  const screens = {
    cockpit: "Cockpit",
    carta: "Carta",
    rotas: "Rotas",
    sos: "Emergência",
    contatos: "Protocolo SOS",
    offline: "Cartas offline",
    historico: "Histórico"
  };

  const db = Store.load();
  const savedSession = db.session && typeof db.session === "object" ? db.session : null;
  const cleanTrack = savedSession && Array.isArray(savedSession.track)
    ? savedSession.track.filter((pt) => (pt.accuracy || 999) <= 40)
    : [];
  const state = {
    screen: "cockpit",
    back: "cockpit",
    waterLock: false,
    tracking: savedSession && typeof savedSession.tracking === "boolean" ? savedSession.tracking : true,
    gps: "searching",
    gpsWatch: null,
    battery: null,
    pos: null,
    track: cleanTrack,
    startedAt: cleanTrack.length && savedSession ? savedSession.startedAt || null : null,
    pausedMs: cleanTrack.length && savedSession ? savedSession.pausedMs || 0 : 0,
    pauseStarted: cleanTrack.length && savedSession ? savedSession.pauseStarted || null : null,
    distanceM: cleanTrack.length > 1 ? Geo.pathLength(cleanTrack) : 0,
    maxKt: cleanTrack.length && savedSession ? savedSession.maxKt || 0 : 0,
    leg: savedSession ? savedSession.leg || 0 : 0,
    follow: true,
    seamarks: false,
    official: true,
    showTrack: true,
    mapTapWp: true,
    fitRoute: false,
    sos: { phase: "idle", remaining: db.sosSeconds, hold: 0 },
    filter: "all",
    strobe: false,
    pack: null,
    cacheBytes: 0,
    chartFilter: "near"
  };

  const headerEl = document.getElementById("header");
  const viewEl = document.getElementById("view");
  const tabEl = document.getElementById("tabbar");
  const lockEl = document.getElementById("lock");
  const sheetEl = document.getElementById("sheet");
  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  let rendered = "";
  let wakeLock = null;
  let audioCtx = null;

  function playSosBeep(mode) {
    if (!db.vhf || !db.vhf.audible) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "square";
      if (mode === "alarm") {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(660, now + 0.18);
        osc.frequency.setValueAtTime(880, now + 0.36);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.56);
      } else {
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (_) {}
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  function persist() { Store.save(db); }

  function saveSession() {
    db.session = state.track.length || state.startedAt
      ? {
          tracking: state.tracking,
          startedAt: state.startedAt,
          pausedMs: state.pausedMs,
          pauseStarted: state.pauseStarted,
          distanceM: state.distanceM,
          maxKt: state.maxKt,
          leg: state.leg,
          track: state.track.slice(-2000)
        }
      : null;
    persist();
  }

  function activeRoute() {
    return db.routes.find((route) => route.id === db.activeRouteId) || null;
  }

  function ensureRoute() {
    let route = activeRoute();
    if (route) return route;
    route = { id: `r${Date.now()}`, name: "Nova rota", waypoints: [] };
    db.routes.unshift(route);
    db.activeRouteId = route.id;
    persist();
    return route;
  }

  function go(screen) {
    if (state.waterLock) return;
    if (screen !== state.screen) state.back = state.screen;
    if (state.screen === "carta" || state.screen === "rotas") NauticalMap.destroy();
    state.screen = screen;
    if (screen !== "sos") state.strobe = false;
    render(true);
  }

  function elapsedMs() {
    if (!state.startedAt) return 0;
    const pause = state.pauseStarted ? Date.now() - state.pauseStarted : 0;
    return Date.now() - state.startedAt - state.pausedMs - pause;
  }

  function fmtKt(value) {
    return value == null || Number.isNaN(value) ? "—" : Number(value).toFixed(1);
  }

  function fmtDeg(value) {
    return value == null || Number.isNaN(value) ? "—" : `${Math.round(value).toString().padStart(3, "0")}°`;
  }

  function pushPoint(lat, lon, knots, heading, accuracy) {
    const next = { lat, lon, knots, heading, accuracy, time: Date.now() };
    const prev = state.pos;
    const precise = (accuracy || 999) <= 40;
    const prevPrecise = prev && (prev.accuracy || 999) <= 40;
    if (!precise) {
      next.knots = null;
      next.heading = null;
    } else if (prevPrecise && (knots == null || heading == null)) {
      const dt = (next.time - prev.time) / 1000;
      const meters = Geo.haversine(prev, next);
      if (knots == null && dt > 0.4 && meters > accuracy) {
        const derived = (meters / dt) * 1.943844;
        next.knots = derived < 0.4 ? 0 : derived;
      }
      if (heading == null && meters > Math.max(8, accuracy)) next.heading = Geo.bearing(prev, next);
    }
    if (precise && next.knots != null && next.knots < 0.4) next.knots = 0;
    state.pos = next;
    state.gps = "live";
    if (precise && next.knots != null) state.maxKt = Math.max(state.maxKt, next.knots);
    if (precise && state.tracking) {
      if (!state.startedAt) state.startedAt = next.time;
      const last = state.track[state.track.length - 1];
      const minStep = Math.max(4, (accuracy || 8) * 0.4);
      if (!last) {
        state.track.push(next);
        saveSession();
      } else {
        const stepM = Geo.haversine(last, next);
        if (stepM >= minStep) {
          state.distanceM += stepM;
          state.track.push(next);
          saveSession();
        }
      }
    }
    const route = activeRoute();
    if (precise && route && route.waypoints.length) {
      const target = route.waypoints[Math.min(state.leg, route.waypoints.length - 1)];
      if (Geo.haversine(next, target) < 40 && state.leg < route.waypoints.length - 1) {
        state.leg += 1;
        saveSession();
      }
    }
  }

  function nearestHazard() {
    if (!state.pos || !db.hazards.length) return null;
    const near = Geo.nearestHazard(state.pos, db.hazards);
    const radius = near.hazard.radius || 80;
    const knots = state.pos.knots || 0;
    const speed = Math.max(knots * Geo.MPS_PER_KT, 0.5);
    const buffer = Math.max(radius, speed * 10);
    const bearingTo = Geo.bearing(state.pos, near.hazard);
    const hasHeading = state.pos.heading != null && knots >= 1;
    const angle = hasHeading ? Geo.angleDiff(state.pos.heading, bearingTo) : 0;
    const inside = near.meters <= radius;
    const closing = inside || !hasHeading || angle <= 75;
    const alert = near.meters <= buffer && closing;
    return { ...near, radius, buffer, bearingTo, angle, closing, inside, seconds: near.meters / speed, alert };
  }

  function routeStats(route) {
    const settings = db.settings;
    const draftM = Math.max(0, Number(settings.draftM) || 0.4);
    const minSafeDepth = Number((draftM + 0.5).toFixed(1));
    const tankL = Math.max(1, Number(settings.tankL) || 60);
    const reserve = Math.min(0.8, Math.max(0, Number(settings.reserve) || 0));
    const cruiseKt = Math.max(1, Number(settings.cruiseKt) || 25);
    const lph = Math.max(0.1, Number(settings.lph) || 18);
    const usable = tankL * (1 - reserve);
    const pts = route ? route.waypoints : [];
    let meters = 0;
    const legs = [];
    for (let i = 1; i < pts.length; i++) {
      const segM = Geo.haversine(pts[i - 1], pts[i]);
      const brg = Geo.bearing(pts[i - 1], pts[i]);
      meters += segM;
      legs.push({ from: i - 1, to: i, meters: segM, nm: segM / Geo.NM, bearing: brg, cardinal: Geo.compass(brg).short });
    }
    const nm = meters / Geo.NM;
    const hours = cruiseKt > 0 ? nm / cruiseKt : 0;
    const fuel = hours * lph;
    const pnrNm = lph > 0 ? ((usable / 2) / lph) * cruiseKt : 0;
    const extraMargin = Math.max(25, Math.round(draftM * 35));
    const hitHazards = [];
    if (pts.length > 1 && db.hazards.length) {
      for (let i = 1; i < pts.length; i++) {
        for (const hazard of db.hazards) {
          if (Geo.segmentHitsHazard(pts[i - 1], pts[i], { ...hazard, radius: hazard.radius || 80 }, extraMargin)) {
            const depthRisk = hazard.depth != null && Number(hazard.depth) < minSafeDepth;
            if (!hitHazards.some((h) => h.name === hazard.name && h.leg === i)) {
              hitHazards.push({ name: hazard.name, leg: i, depth: hazard.depth, depthRisk });
            }
          }
        }
      }
    }
    const shallow = hitHazards.length > 0;
    let remainM = null;
    let cog = null;
    let etaMin = null;
    if (state.pos && pts.length) {
      const target = pts[Math.min(state.leg, pts.length - 1)];
      remainM = Geo.haversine(state.pos, target);
      cog = Geo.bearing(state.pos, target);
      const pace = state.pos.knots || cruiseKt;
      etaMin = pace > 0.5 ? (remainM / Geo.NM) / pace * 60 : null;
    }
    return { meters, nm, hours, fuel, usable, tankL, reserve, cruiseKt, lph, draftM, minSafeDepth, pnrNm, shallow, hitHazards, legs, remainM, cog, etaMin, points: pts.length };
  }

  const officialChart = {
    id: "1636",
    title: "Porto de Angra dos Reis e proximidades",
    aviso: "2026-89",
    url: "charts/1636/{z}/{x}/{y}.png",
    minZoom: 11,
    maxNativeZoom: 16,
    south: -23.133333299943,
    west: -44.3833333,
    north: -22.991666709044,
    east: -44.171666707138
  };

  function mapData() {
    const route = activeRoute();
    const isRotas = state.screen === "rotas";
    return {
      pos: state.pos,
      track: state.track,
      route: route ? route.waypoints : [],
      leg: state.leg,
      pois: db.pois,
      hazards: db.hazards,
      seamarks: state.seamarks,
      showTrack: state.showTrack,
      follow: isRotas || state.frameChart || state.fitRoute ? false : state.follow,
      frameChart: state.frameChart,
      fitRoute: state.fitRoute,
      chart: state.official ? officialChart : null
    };
  }

  function insideOfficial() {
    if (!state.pos) return false;
    const chart = officialChart;
    return state.pos.lat >= chart.south && state.pos.lat <= chart.north
      && state.pos.lon >= chart.west && state.pos.lon <= chart.east;
  }

  function syncMap() {
    const id = state.screen === "rotas" ? "map-mini" : "map";
    const el = document.getElementById(id);
    if (!el) return;
    const onMapTap = state.screen === "rotas"
      ? (ll) => {
          if (state.waterLock || !state.mapTapWp) return;
          const route = ensureRoute();
          const nameEl = document.getElementById("wp-name");
          const rawName = nameEl ? nameEl.value.trim() : "";
          const name = rawName || `WP ${route.waypoints.length + 1}`;
          route.waypoints.push({ name, lat: Number(ll.lat.toFixed(5)), lon: Number(ll.lon.toFixed(5)) });
          if (nameEl) nameEl.value = "";
          persist();
          patchRotas();
          toast(`${name} adicionado no mapa.`);
        }
      : null;
    const ok = NauticalMap.mount(el, () => {
      state.follow = false;
      const followBtn = document.getElementById("carta-follow");
      if (followBtn) followBtn.className = "chip";
    }, onMapTap);
    if (ok) {
      const route = activeRoute();
      if (state.screen === "rotas" && route && route.waypoints.length) state.fitRoute = true;
      NauticalMap.update(mapData());
      state.frameChart = false;
      state.fitRoute = false;
    }
  }

  function gpsLabel() {
    if (state.gps === "live") return "GPS";
    if (state.gps === "denied") return "SEM PERMISSÃO";
    if (state.gps === "unavailable") return "SEM SINAL";
    return "BUSCANDO";
  }

  function headerHtml() {
    const accuracy = state.pos ? `± ${Math.round(state.pos.accuracy || 0)} M` : "—";
    const battery = state.battery == null ? "" : `<span class="chip"><span class="ms fill">bolt</span> ${state.battery}%</span>`;
    return `<div class="brand">
      <div class="brand-id">
        ${state.screen === "cockpit" || state.screen === "carta" || state.screen === "rotas" || state.screen === "sos"
          ? `<div class="mark"><span class="ms">sailing</span></div>`
          : `<button class="icon-btn" type="button" data-action="back" aria-label="Voltar"><span class="ms">arrow_back</span></button>`}
        <div>
          <div class="kicker">JETSKINAV</div>
          <h1 class="screen-title">${esc(screens[state.screen])}</h1>
        </div>
      </div>
      <button class="avatar" type="button" data-action="menu" aria-label="Menu"><span class="ms">person</span></button>
    </div>
    <div class="status-row">
      ${battery}
      <span class="chip" id="sat-chip"><span class="ms fill">satellite_alt</span> ${accuracy}</span>
      <span class="chip live" id="gps-chip">${gpsLabel()}</span>
      <span class="chip sun"><span class="ms fill">light_mode</span> SOL</span>
      <button class="chip" type="button" data-action="lock"><span class="ms fill">water_drop</span> TRAVA ÁGUA</button>
    </div>`;
  }

  function navHtml() {
    const items = [
      ["cockpit", "speed", "Cockpit", ""],
      ["carta", "map", "Carta", ""],
      ["rotas", "polyline", "Rotas", ""],
      ["sos", "emergency_home", "SOS", "sos"]
    ];
    return items.map(([id, icon, label, extra]) => {
      const active = state.screen === id ? "active" : "";
      return `<button class="tab ${extra} ${active}" type="button" data-action="go" data-screen="${id}"><span class="ms">${icon}</span>${label}</button>`;
    }).join("");
  }

  function sogSignalStatus() {
    if (!state.pos) return { text: gpsLabel(), cls: "chip" };
    if ((state.pos.accuracy || 999) <= 40) return { text: "GNSS PRECISO", cls: "chip live" };
    return { text: "SINAL > 40M", cls: "chip warn" };
  }

  function cockpitHtml() {
    const cog = state.pos && state.pos.heading != null ? Geo.compass(state.pos.heading) : null;
    const nm = state.distanceM / Geo.NM;
    const hazard = nearestHazard();
    const sig = sogSignalStatus();
    const kmh = state.pos && state.pos.knots != null ? `${(state.pos.knots * 1.852).toFixed(0)} KM/H` : "KM/H —";
    const alert = !state.pos
      ? `<div class="alert"><div class="alert-ico"><span class="ms">satellite_alt</span></div><div class="grow"><strong id="hazard-title">${state.gps === "denied" ? "PERMISSÃO DE GPS NEGADA" : "AGUARDANDO FIX GNSS"}</strong><div class="micro" id="hazard-sub">${state.gps === "denied" ? "Libere a localização para este site e tente de novo." : "A velocidade e o rumo aparecem quando o aparelho tiver posição."}</div></div></div>`
      : hazard && hazard.alert
        ? `<div class="alert ${hazard.inside ? "danger" : ""}" id="hazard-box"><div class="alert-ico"><span class="ms fill">warning</span></div><div class="grow"><strong id="hazard-title">${esc(hazard.hazard.name).toUpperCase()} A ${Math.round(hazard.meters)} M</strong><div class="micro" id="hazard-sub">${hazard.hazard.depth != null ? `PROF. INFORMADA ${Number(hazard.hazard.depth).toFixed(1)} M · ` : ""}MARCAÇÃO ${fmtDeg(hazard.bearingTo)} (${Geo.compass(hazard.bearingTo).short})</div></div><span class="badge" id="hazard-badge">${Math.max(1, Math.round(hazard.seconds))}S</span></div>`
        : `<div class="alert" style="background:#e7f8ef"><div class="alert-ico" style="background:#067647"><span class="ms">verified</span></div><div class="grow"><strong id="hazard-title">${db.hazards.length ? "NENHUM BAIXIO À PROA" : "SEM BAIXIOS MARCADOS"}</strong><div class="micro" id="hazard-sub">${db.hazards.length ? "Os pontos que você marcou estão fora do cone/alcance de 10 s." : "Marque um baixio na carta para o alerta usar essa posição."}</div></div></div>`;
    return `<section class="card speed-card">
      <div class="spread"><span class="micro"><span class="pulse">●</span> SOG // GNSS</span><span class="${sig.cls}" id="sog-chip">${sig.text}</span></div>
      <div class="baseline"><span class="speed-num" id="sog">${fmtKt(state.pos && state.pos.knots)}</span><div class="unit-col"><strong>NÓS</strong><span class="micro">KT</span></div></div>
      <div class="subline"><span id="kmh">${kmh}</span><span id="acc">${state.pos ? `PRECISÃO ${Math.round(state.pos.accuracy || 0)} M` : "SEM FIX"}</span></div>
    </section>
    <div class="tiles">
      <article class="tile"><span class="micro">RUMO // COG</span><b id="cog">${fmtDeg(state.pos && state.pos.heading)}</b><span class="micro accent" id="cog-name">${cog ? cog.name : "—"}</span></article>
      <article class="tile"><span class="micro">DISTÂNCIA</span><b id="dist">${nm.toFixed(2)}</b><span class="micro" id="dist-km">NM · ${(nm * 1.852).toFixed(1)} KM</span></article>
      <article class="tile"><span class="micro">TEMPO TRACK</span><b id="time" style="font-size:16px">${Geo.formatDuration(elapsedMs())}</b><span class="micro accent" id="rec">${!state.pos ? "SEM FIX" : (state.pos.accuracy || 999) > 40 ? "AGUARD. <=40M" : state.tracking ? "GRAVANDO" : "PAUSADO"}</span></article>
    </div>
    <section class="card" id="hazard-card">${alert}</section>
    ${state.gps === "denied" ? `<button class="btn primary" type="button" data-action="gps">TENTAR GPS DE NOVO</button>` : ""}
    <div class="actions">
      <button class="btn danger" type="button" data-hold="sos" aria-label="SOS, segure 3 segundos"><span class="hold-bar" id="hold-bar"></span><span class="ms fill">emergency</span>SOS<span class="hint">SEGURE 3S</span></button>
      <button class="btn ghost" type="button" data-action="toggle-track"><span class="ms">${state.tracking ? "pause_circle" : "play_circle"}</span>${state.tracking ? "PAUSAR" : "RETOMAR"}<span class="hint" id="pts">${state.track.length} PTS</span></button>
      <button class="btn primary" type="button" data-action="go" data-screen="carta"><span class="ms">map</span>MAPA</button>
    </div>`;
  }

  function destinationHtml() {
    const route = activeRoute();
    const stats = routeStats(route);
    if (!route || !route.waypoints.length) {
      return `<section class="card" id="carta-dest-card"><div class="micro">DESTINO</div><h2 style="margin:4px 0">Nenhum waypoint</h2><p class="micro">Crie a rota e marque os pontos com o GPS.</p></section>`;
    }
    const legIdx = Math.min(state.leg, route.waypoints.length - 1);
    const dest = route.waypoints[legIdx];
    return `<section class="card" id="carta-dest-card">
      <div class="spread"><span class="micro">DESTINO EM CURSO</span><span class="micro accent" id="carta-dest-leg">WP ${legIdx + 1}/${route.waypoints.length}</span></div>
      <h2 style="margin:4px 0" id="carta-dest-name">${esc(dest.name)}</h2>
      <div class="tiles">
        <article class="tile"><span class="micro">DISTÂNCIA</span><b id="carta-nm">${stats.remainM == null ? "—" : (stats.remainM / Geo.NM).toFixed(1)}</b><span class="micro">NM</span></article>
        <article class="tile"><span class="micro">ETA</span><b id="carta-eta">${stats.etaMin == null ? "—" : String(Math.max(1, Math.round(stats.etaMin)))}</b><span class="micro">MIN</span></article>
        <article class="tile"><span class="micro">RUMO</span><b id="carta-hdg">${fmtDeg(stats.cog)}</b><span class="micro" id="carta-hdg-cardinal">${stats.cog == null ? "—" : Geo.compass(stats.cog).short}</span></article>
      </div>
    </section>`;
  }

  function cartaAlertHtml() {
    const hazard = nearestHazard();
    if (!hazard || !hazard.alert) return "";
    return `<div class="alert ${hazard.inside ? "danger" : ""}" id="carta-hazard-box"><div class="alert-ico"><span class="ms fill">warning</span></div><div class="grow"><strong id="carta-hazard-title">${esc(hazard.hazard.name).toUpperCase()} A ${Math.round(hazard.meters)} M</strong><div class="micro" id="carta-hazard-sub">${hazard.hazard.depth != null ? `PROF. ${Number(hazard.hazard.depth).toFixed(1)} M · ` : ""}MARCAÇÃO ${fmtDeg(hazard.bearingTo)} (${Geo.compass(hazard.bearingTo).short})</div></div><span class="badge" id="carta-hazard-badge">${Math.max(1, Math.round(hazard.seconds))}S</span></div>`;
  }

  function cartaCaptionText() {
    return state.official
      ? `Carta ${officialChart.id} DHN, aviso ${officialChart.aviso}, escala 1:22.000. ${state.pos ? (insideOfficial() ? "Posição dentro da folha." : "A posição está fora desta folha.") : ""} Use junto com a carta em papel. © Diretoria de Hidrografia e Navegação.`
      : "Mapa © OpenStreetMap e marcas © OpenSeaMap. Não substitui carta náutica oficial.";
  }

  function fmtMarkDist(pt) {
    if (!state.pos) return "";
    const m = Geo.haversine(state.pos, pt);
    return m < 1000 ? ` · a ${Math.round(m)} m` : ` · a ${(m / Geo.NM).toFixed(1)} NM`;
  }

  function cartaMarksHtml() {
    if (!db.hazards.length && !db.pois.length) {
      return `<p class="micro">Nenhum POI ou baixio marcado ainda neste aparelho.</p>`;
    }
    const hRows = db.hazards.map((h) => `<article class="item">
      <div class="index" style="background:var(--amber)">BX</div>
      <div class="body">
        <h3>${esc(h.name)}</h3>
        <p>Raio ${h.radius || 80} m${h.depth != null ? ` · Prof. ${Number(h.depth).toFixed(1)} m` : ""}${fmtMarkDist(h)}</p>
      </div>
      <button class="icon-btn" type="button" data-action="focus-mark" data-lat="${h.lat}" data-lon="${h.lon}" aria-label="Ver no mapa"><span class="ms">my_location</span></button>
      <button class="icon-btn" type="button" data-action="del-hazard" data-id="${esc(h.id)}" aria-label="Remover baixio"><span class="ms">delete</span></button>
    </article>`);
    const pRows = db.pois.map((p) => `<article class="item">
      <div class="index" style="background:var(--hydro)">POI</div>
      <div class="body">
        <h3>${esc(p.name)}</h3>
        <p>${Geo.toDms(p.lat, true)} · ${Geo.toDms(p.lon, false)}${fmtMarkDist(p)}</p>
      </div>
      <button class="icon-btn" type="button" data-action="focus-mark" data-lat="${p.lat}" data-lon="${p.lon}" aria-label="Ver no mapa"><span class="ms">my_location</span></button>
      <button class="icon-btn" type="button" data-action="del-poi" data-id="${esc(p.id)}" aria-label="Remover POI"><span class="ms">delete</span></button>
    </article>`);
    return `<div class="list">${hRows.concat(pRows).join("")}</div>`;
  }

  function cartaHtml() {
    const lowAcc = state.pos && (state.pos.accuracy || 999) > 40;
    return `<div id="carta-alert">${cartaAlertHtml()}</div>
    <div class="spread">
      <span class="chip ${lowAcc ? "warn" : ""}" id="carta-sog">${lowAcc ? "SOG >40M" : `SOG ${fmtKt(state.pos && state.pos.knots)} KT`}</span>
      <span class="chip" id="carta-cog">COG ${state.pos && state.pos.heading != null ? Math.round(state.pos.heading) + "°" : "—"}</span>
      <button class="chip ${state.follow ? "live" : ""}" id="carta-follow" type="button" data-action="recenter">MINHA POSIÇÃO</button>
      <button class="chip ${state.official && insideOfficial() ? "live" : ""}" id="carta-sheet" type="button" data-action="frame-chart">FOLHA 1636</button>
    </div>
    <div class="map-frame">
      <div id="map"></div>
      <div class="map-tools">
        <button type="button" id="layer-official" class="${state.official ? "on" : ""}" aria-pressed="${state.official}" data-action="layer" data-layer="official" aria-label="Carta 1636 da Marinha">${state.official ? "1636" : "OSM"}</button>
        <button type="button" id="layer-seamarks" class="${state.seamarks ? "on" : ""}" aria-pressed="${state.seamarks}" data-action="layer" data-layer="seamarks" aria-label="Marcas náuticas">${state.seamarks ? "SEA" : "sea"}</button>
        <button type="button" id="layer-track" class="${state.showTrack ? "on" : ""}" aria-pressed="${state.showTrack}" data-action="layer" data-layer="track" aria-label="Rastro">${state.showTrack ? "TR" : "tr"}</button>
      </div>
    </div>
    ${destinationHtml()}
    <label class="field"><span>NOME DO PONTO</span><input id="mark-name" type="text" placeholder="Baixio, poita, marina..." /></label>
    <div class="form-grid">
      <label class="field"><span>PROF. (M, OPCIONAL)</span><input id="mark-depth" type="number" min="0" step="0.1" placeholder="—" /></label>
      <label class="field"><span>RAIO (M)</span><input id="mark-radius" type="number" min="15" max="2000" step="10" value="80" /></label>
    </div>
    <div class="actions">
      <button class="btn" type="button" data-action="mark-poi">MARCAR POI</button>
      <button class="btn" type="button" data-action="mark-hazard">MARCAR BAIXIO</button>
      <button class="btn primary" type="button" data-action="go" data-screen="offline">OFFLINE</button>
    </div>
    <h2 class="section-title" id="carta-marks-title">Pontos marcados (${db.hazards.length + db.pois.length})</h2>
    <div id="carta-marks">${cartaMarksHtml()}</div>
    <p class="micro" id="carta-caption">${esc(cartaCaptionText())}</p>`;
  }

  function rotasStatsHtml(stats) {
    const km = (stats.nm * 1.852).toFixed(1);
    const fuelPct = stats.points >= 2 && stats.usable > 0 ? Math.min(100, Math.round((stats.fuel / stats.usable) * 100)) : 0;
    return `<article class="card stat"><span class="micro">DISTÂNCIA</span><b id="rotas-nm">${stats.nm.toFixed(1)}</b><span class="micro" id="rotas-km">NM · ${km} KM</span></article>
      <article class="card stat"><span class="micro">TEMPO</span><b id="rotas-min">${stats.points >= 2 ? Math.round(stats.hours * 60) : "—"}</b><span class="micro" id="rotas-cruise">MIN A ${stats.cruiseKt} KT</span></article>
      <article class="card stat"><span class="micro">COMBUSTÍVEL</span><b id="rotas-fuel">${stats.points >= 2 ? stats.fuel.toFixed(1) : "—"}</b><span class="micro" id="rotas-usable">L DE ${stats.usable.toFixed(0)} L ÚTEIS (${fuelPct}%)</span></article>
      <article class="card stat"><span class="micro">PONTO DE NÃO RETORNO</span><b id="rotas-pnr">${stats.pnrNm.toFixed(1)}</b><span class="micro">NM (IDA C/ RESERVA)</span></article>`;
  }

  function rotasWaypointsHtml(route, stats) {
    if (!route || !route.waypoints.length) {
      return `<p class="micro">Nenhum waypoint ainda. Toque no mini-mapa acima (com TOQUE MAPA ativo), escolha um POI salvo ou use a posição GNSS.</p>`;
    }
    return route.waypoints.map((wp, i) => {
      const isStart = i === 0;
      const isEnd = i === route.waypoints.length - 1 && route.waypoints.length > 1;
      const legInfo = i > 0 && stats && stats.legs[i - 1] ? stats.legs[i - 1] : null;
      const roleTag = isStart
        ? "PARTIDA"
        : `${isEnd ? "DESTINO" : `TRECHO ${i}`} · +${legInfo ? legInfo.nm.toFixed(2) : "0.00"} NM · RUMO ${legInfo ? fmtDeg(legInfo.bearing) : "—"} ${legInfo ? legInfo.cardinal : ""}`;
      const badgeBg = isEnd ? "background:var(--danger)" : isStart ? "background:var(--hydro)" : "";
      return `<article class="item">
        <div class="index" style="${badgeBg}">${i + 1}</div>
        <div class="body">
          <div class="micro accent">${roleTag}</div>
          <h3>${esc(wp.name)}</h3>
          <p>${Geo.toDms(wp.lat, true)} · ${Geo.toDms(wp.lon, false)}</p>
        </div>
        ${i > 0 ? `<button class="icon-btn" type="button" data-action="move-wp" data-index="${i}" data-dir="-1" aria-label="Subir waypoint"><span class="ms">arrow_upward</span></button>` : ""}
        ${i < route.waypoints.length - 1 ? `<button class="icon-btn" type="button" data-action="move-wp" data-index="${i}" data-dir="1" aria-label="Descer waypoint"><span class="ms">arrow_downward</span></button>` : ""}
        <button class="icon-btn" type="button" data-action="focus-wp" data-lat="${wp.lat}" data-lon="${wp.lon}" aria-label="Focar no mapa"><span class="ms">my_location</span></button>
        <button class="icon-btn" type="button" data-action="del-wp" data-index="${i}" aria-label="Remover"><span class="ms">close</span></button>
      </article>`;
    }).join("");
  }

  function rotasChecksHtml(stats) {
    const fuelOk = stats.points >= 2 && stats.fuel <= stats.usable;
    const pnrOk = stats.points >= 2 && stats.nm <= stats.pnrNm * 2;
    const cacheOk = db.tilePacks.length > 0 || state.official;
    const shallowDetail = stats.points < 2
      ? `Adicione ao menos 2 waypoints (calado mín. seguro ${stats.minSafeDepth} m).`
      : stats.shallow
        ? `Colisão detectada: ${stats.hitHazards.map((h) => `${h.name} (trecho ${h.leg}${h.depth != null ? `, prof. ${h.depth}m` : ""})`).join(", ")}.`
        : db.hazards.length
          ? `Livre dos ${db.hazards.length} baixio(s) marcados (margem p/ calado ${stats.draftM}m).`
          : `Você ainda não marcou baixios na Carta (calado ${stats.draftM}m → mín. seguro ${stats.minSafeDepth}m).`;
    const fuelDetail = stats.points < 2
      ? `Tanque ${stats.tankL}L · Reserva ${Math.round(stats.reserve * 100)}% (${stats.usable.toFixed(0)}L úteis) · PNR ${stats.pnrNm.toFixed(1)} NM.`
      : fuelOk
        ? `Consumo ${stats.fuel.toFixed(1)}L cabe nos ${stats.usable.toFixed(0)}L úteis (sobra ${(stats.usable - stats.fuel).toFixed(1)}L).${pnrOk ? "" : " Atenção: distância total excede ida+volta do PNR."}`
        : `Faltam ${(stats.fuel - stats.usable).toFixed(1)}L! Consumo (${stats.fuel.toFixed(1)}L) supera o combustível útil (${stats.usable.toFixed(0)}L).`;
    return `<div class="check ${stats.points < 2 ? "" : stats.shallow ? "bad" : "ok"}"><span class="ms">${stats.shallow ? "warning" : "verified"}</span><div><strong>Baixios e Calado (${stats.draftM}m)</strong><div class="micro">${esc(shallowDetail)}</div></div></div>
      <div class="check ${stats.points < 2 ? "" : fuelOk ? "ok" : "bad"}"><span class="ms">${fuelOk ? "verified" : "warning"}</span><div><strong>Reserva de combustível</strong><div class="micro">${esc(fuelDetail)}</div></div></div>
      <div class="check ${cacheOk ? "ok" : "bad"}"><span class="ms">${cacheOk ? "verified" : "warning"}</span><div><strong>Carta no aparelho</strong><div class="micro">${db.tilePacks.length ? `${db.tilePacks.length} área(s) OSM no cache + Folha 1636 DHN local.` : "Folha 1636 DHN local ativa. Para OSM fora de Angra, baixe em Offline."}</div></div></div>`;
  }

  function patchRotas() {
    if (state.screen !== "rotas") return;
    const route = ensureRoute();
    const stats = routeStats(route);
    const statsEl = document.getElementById("rotas-stats");
    if (statsEl) statsEl.innerHTML = rotasStatsHtml(stats);
    const wpTitle = document.getElementById("rotas-wp-title");
    if (wpTitle) wpTitle.textContent = `Waypoints (${route.waypoints.length})`;
    const wpList = document.getElementById("rotas-waypoints");
    if (wpList) wpList.innerHTML = rotasWaypointsHtml(route, stats);
    const checksEl = document.getElementById("rotas-checks");
    if (checksEl) checksEl.innerHTML = rotasChecksHtml(stats);
    const sel = document.getElementById("route-select");
    if (sel) {
      Array.from(sel.options).forEach((opt) => {
        const r = db.routes.find((item) => item.id === opt.value);
        if (r) opt.textContent = `${r.name} (${r.waypoints.length} WP)`;
      });
    }
    const tapBtn = document.getElementById("btn-tap-wp");
    if (tapBtn) {
      tapBtn.className = `chip ${state.mapTapWp ? "live" : ""}`;
      tapBtn.textContent = state.mapTapWp ? "TOQUE MAPA: ON" : "TOQUE MAPA: OFF";
    }
    NauticalMap.update(mapData());
    state.fitRoute = false;
  }

  function rotasHtml() {
    const route = ensureRoute();
    const stats = routeStats(route);
    const poiButtons = db.pois.length
      ? `<div class="filters" style="margin-top:4px">${db.pois.map((p) => `<button type="button" data-action="add-wp-poi" data-id="${esc(p.id)}">+ POI: ${esc(p.name)}</button>`).join("")}</div>`
      : "";
    return `<section class="card flat stack">
      <div class="spread">
        <span class="micro">ROTA DESTE APARELHO (${db.routes.length})</span>
        <div style="display:flex;gap:6px">
          <button class="chip" type="button" data-action="new-route">+ NOVA</button>
          <button class="chip" type="button" data-action="del-route">LIMPAR / EXCLUIR</button>
        </div>
      </div>
      <label class="field"><span>SELECIONAR ROTA SALVA</span>
        <select id="route-select">
          ${db.routes.map((r) => `<option value="${esc(r.id)}" ${r.id === route.id ? "selected" : ""}>${esc(r.name)} (${r.waypoints.length} WP)</option>`).join("")}
        </select>
      </label>
      <label class="field"><span>NOME DA ROTA</span><input id="route-name" data-field="route-name" type="text" value="${esc(route.name)}" /></label>
      <div class="form-grid">
        <label class="field"><span>CALADO (M)</span><input data-field="draftM" type="number" min="0.1" max="5" step="0.1" value="${db.settings.draftM}" /></label>
        <label class="field"><span>TANQUE (L)</span><input data-field="tankL" type="number" min="5" max="500" step="1" value="${db.settings.tankL}" /></label>
        <label class="field"><span>RESERVA (%)</span><input data-field="reserve" type="number" min="0" max="80" step="5" value="${Math.round(db.settings.reserve * 100)}" /></label>
        <label class="field"><span>CRUZEIRO (KT)</span><input data-field="cruiseKt" type="number" min="1" max="85" step="1" value="${db.settings.cruiseKt}" /></label>
        <label class="field"><span>CONSUMO (L/H)</span><input data-field="lph" type="number" min="1" max="150" step="0.5" value="${db.settings.lph}" /></label>
      </div>
    </section>
    <div class="spread">
      <button class="chip ${state.mapTapWp ? "live" : ""}" id="btn-tap-wp" type="button" data-action="toggle-tap-wp">${state.mapTapWp ? "TOQUE MAPA: ON" : "TOQUE MAPA: OFF"}</button>
      <button class="chip" type="button" data-action="fit-route">ENQUADRAR ROTA</button>
      <button class="chip" type="button" data-action="reverse-route">INVERTER</button>
    </div>
    <div class="map-frame"><div id="map-mini"></div></div>
    <div class="stat-grid" id="rotas-stats">${rotasStatsHtml(stats)}</div>
    <h2 class="section-title" id="rotas-wp-title">Waypoints (${route.waypoints.length})</h2>
    <div class="list" id="rotas-waypoints">${rotasWaypointsHtml(route, stats)}</div>
    <label class="field"><span>NOVO WAYPOINT</span><input id="wp-name" type="text" placeholder="Nome do ponto (ou toque no mapa acima)" /></label>
    <div class="actions">
      <button class="btn small primary" type="button" data-action="add-wp-here">NA POSIÇÃO ATUAL</button>
      <button class="btn small" type="button" data-action="add-wp-dest">COMO DESTINO</button>
      <button class="btn small ghost" type="button" data-action="reverse-route">IDA/VOLTA</button>
    </div>
    ${poiButtons}
    <h2 class="section-title">Verificação</h2>
    <div class="checks" id="rotas-checks">${rotasChecksHtml(stats)}</div>
    <button class="btn primary" type="button" data-action="start-route">INICIAR NAVEGAÇÃO</button>
    <div class="actions">
      <button class="btn small" type="button" data-action="save-route">SALVAR</button>
      <button class="btn small" type="button" data-action="gpx-route">EXPORTAR GPX</button>
      <label class="btn small">IMPORTAR GPX<input id="gpx-route-file" type="file" accept=".gpx,application/gpx+xml,.xml" hidden /></label>
    </div>`;
  }

  function cleanPhone(raw) {
    return String(raw || "").replace(/[^\d+]/g, "");
  }

  function buildSosPayload() {
    if (!state.pos) return null;
    const latDms = Geo.toDms(state.pos.lat, true);
    const lonDms = Geo.toDms(state.pos.lon, false);
    const dec = `${state.pos.lat.toFixed(5)}, ${state.pos.lon.toFixed(5)}`;
    const maps = `https://maps.google.com/?q=${state.pos.lat.toFixed(5)},${state.pos.lon.toFixed(5)}`;
    const acc = Math.round(state.pos.accuracy || 0);
    const sog = state.pos.knots != null ? `${state.pos.knots.toFixed(1)}kt` : "deriva";
    const cog = state.pos.heading != null ? ` ${fmtDeg(state.pos.heading)} ${Geo.compass(state.pos.heading).short}` : "";
    const bat = state.battery != null ? ` Bat:${state.battery}%` : "";
    const vhf = db.vhf && db.vhf.marina ? ` VHF:${db.vhf.marina}` : " VHF:16";
    const text = `SOCORRO JET SKI! Pos: ${latDms} ${lonDms} (${dec}) ±${acc}m. SOG:${sog}${cog}.${bat}${vhf}. Mapa: ${maps}`;
    const phone = db.contacts[0] ? cleanPhone(db.contacts[0].phone) : "";
    const href = `sms:${phone}?body=${encodeURIComponent(text)}`;
    return { latDms, lonDms, dec, maps, acc, text, phone, href };
  }

  function sosHtml() {
    const counting = state.sos.phase === "counting";
    const ready = state.sos.phase === "ready";
    const payload = buildSosPayload();
    const lowAcc = payload && payload.acc > 40;
    const primaryContact = db.contacts[0] || null;
    const contactNote = primaryContact
      ? `Destinatário P1: ${primaryContact.name} (${primaryContact.phone})`
      : "Nenhum contato salvo — o SMS abrirá sem destinatário para você escolher na hora.";
    const kinematics = !state.pos
      ? "Sem cinemática GNSS"
      : state.pos.knots != null
        ? `SOG ${state.pos.knots.toFixed(1)} KT · RUMO ${fmtDeg(state.pos.heading)} ${state.pos.heading != null ? Geo.compass(state.pos.heading).short : ""}`
        : `SINAL > 40M (±${payload.acc}M) · DERIVA / BAIXA PRECISÃO`;
    return `<section class="sos-banner ${counting || ready ? "pulse" : ""}">
      <div class="spread" style="color:white">
        <span class="micro" style="color:white">${ready ? "SOS ATIVO // EMERGÊNCIA" : "ALERTA DE SEGURANÇA"}</span>
        <span class="chip" style="background:white;color:var(--danger)">${db.vhf && db.vhf.marina ? `VHF CH 16 / ${esc(db.vhf.marina)}` : "VHF CH 16"}</span>
      </div>
      <div class="sos-count" id="sos-count">${counting ? state.sos.remaining : ready ? "SOS" : "—"}</div>
      <div id="sos-status-label">${counting ? "CONTAGEM PARA ARMAR O ALERTA" : ready ? "ALERTA ARMADO — ENVIE O SMS OU LIGUE 185" : "SOS EM ESPERA"}</div>
    </section>
    <section class="card stack">
      <div class="spread">
        <span class="micro">COORDENADAS DE RESGATE (WGS-84)</span>
        <span class="chip ${!payload ? "" : lowAcc ? "warn" : "live"}" id="sos-acc-chip">${payload ? `± ${payload.acc} M` : gpsLabel()}</span>
      </div>
      <div class="coord" id="sos-coord">${payload ? `${payload.latDms}<br>${payload.lonDms}` : "SEM FIX GNSS"}</div>
      <div class="subline" id="sos-dec">${payload ? `DEC: ${payload.dec}` : "AGUARDANDO SATÉLITES"}</div>
      <div class="micro" id="sos-kin">${esc(kinematics)}</div>
    </section>
    ${counting || ready
      ? `<button class="btn navy" type="button" data-action="cancel-sos"><span class="ms">cancel</span>${counting ? "CANCELAR DISPARO (FALSO ALARME)" : "ENCERRAR ALERTA SOS"}</button>`
      : `<button class="btn danger" type="button" data-action="arm-sos"><span class="ms fill">emergency</span>INICIAR CONTAGEM ${db.sosSeconds}S</button>`}
    ${payload
      ? `<a class="btn primary" id="sos-sms-link" href="${payload.href}"><span class="ms fill">send_to_mobile</span>DISPARAR SMS COM MAPA<span class="hint" id="sos-sms-hint">${esc(contactNote)}</span></a>`
      : `<button class="btn" id="sos-sms-disabled" type="button" disabled>SMS AGUARDA POSIÇÃO GNSS</button>`}
    <div class="form-grid">
      <a class="btn danger small" href="tel:185"><span class="ms fill">phone_in_talk</span>SALVAMAR · 185</a>
      <a class="btn small" style="background:var(--amber);color:white" href="tel:193"><span class="ms fill">local_fire_department</span>BOMBEIROS · 193</a>
    </div>
    <div class="form-grid">
      <button class="btn small" type="button" data-action="copy-coord"><span class="ms">content_copy</span>COPIAR COORD.</button>
      <button class="btn small" type="button" data-action="share-sos"><span class="ms">share</span>COMPARTILHAR</button>
    </div>
    <button class="btn ${state.strobe ? "danger" : "ghost"} small" type="button" data-action="strobe"><span class="ms fill">flash_on</span>${state.strobe ? "PARAR ESTROBO E ALARME" : "ESTROBO VISUAL + APITO SONORO"}</button>
    <button class="btn small" type="button" data-action="go" data-screen="contatos"><span class="ms">contacts</span>CONFIGURAR CONTATOS E VHF (${db.contacts.length})</button>
    <p class="micro">O app monta o SMS com DMS, decimal, precisão, bateria e link do mapa. O envio depende da rede celular ou satélite do aparelho.</p>`;
  }

  function contatosListHtml() {
    if (!db.contacts.length) {
      return `<p class="micro">Nenhum contato cadastrado. Adicione a Marina ou familiar para preencher o SMS de socorro automaticamente.</p>`;
    }
    return db.contacts.map((contact, idx) => `<article class="item">
      <div class="index" style="${idx === 0 ? "background:var(--danger)" : ""}">P${contact.priority}</div>
      <div class="body">
        <div class="micro accent">${idx === 0 ? "DISPARO IMEDIATO (SMS PRINCIPAL)" : `CONTATO RESERVA #${idx + 1}`}</div>
        <h3>${esc(contact.name)}</h3>
        <p>${esc(contact.phone)}</p>
      </div>
      ${idx > 0 ? `<button class="icon-btn" type="button" data-action="move-contact" data-index="${idx}" data-dir="-1" aria-label="Subir prioridade"><span class="ms">arrow_upward</span></button>` : ""}
      <a class="icon-btn" href="tel:${esc(cleanPhone(contact.phone))}" aria-label="Ligar"><span class="ms">call</span></a>
      <button class="icon-btn" type="button" data-action="del-contact" data-id="${esc(contact.id)}" aria-label="Remover"><span class="ms">delete</span></button>
    </article>`).join("");
  }

  function contatosHtml() {
    const payload = buildSosPayload();
    const preview = payload ? payload.text : "A mensagem completa entra assim que houver fix GNSS.";
    return `<section class="card stack">
      <div class="spread">
        <span class="micro">1. RÁDIO VHF &amp; FREQUÊNCIAS</span>
        <span class="chip live">NORMAS MARINHA</span>
      </div>
      <article class="item"><div class="index" style="background:var(--danger)">16</div><div class="body"><h3>156.800 MHz (VHF Marítimo)</h3><p>Socorro e chamada internacional obrigatória. Escuta permanente 24/7.</p></div></article>
      <label class="field"><span>CANAL DE APOIO DA MARINA LOCAL</span><input id="vhf-marina" data-field="vhf" type="text" value="${esc(db.vhf.marina)}" placeholder="Ex.: CH 68 (Marina Piratas / Porto Real)" /></label>
      <button class="btn small ${db.vhf.audible ? "primary" : ""}" id="btn-toggle-vhf" type="button" data-action="toggle-vhf"><span class="ms">${db.vhf.audible ? "volume_up" : "volume_off"}</span>ALARME SONORO DE EMERGÊNCIA: ${db.vhf.audible ? "LIGADO" : "DESLIGADO"}</button>
    </section>
    <h2 class="section-title" id="contatos-title">2. Contatos de resgate (${db.contacts.length})</h2>
    <div class="list" id="contatos-list">${contatosListHtml()}</div>
    <div class="card flat stack">
      <div class="micro">NOVO CONTATO DE EMERGÊNCIA</div>
      <label class="field"><span>NOME / MARINA</span><input id="c-name" type="text" placeholder="Ex.: Marina Porto Real / Família" /></label>
      <label class="field"><span>TELEFONE (COM DDD)</span><input id="c-phone" type="tel" placeholder="+55 21 99999-9999" /></label>
      <button class="btn small primary" type="button" data-action="add-contact"><span class="ms">person_add</span>ADICIONAR CONTATO</button>
    </div>
    <section class="card stack">
      <div class="micro">PRÉVIA DA MENSAGEM SOS (ATUALIZA AO VIVO)</div>
      <p id="sos-preview" style="margin:0;font-family:var(--mono);font-size:12px;word-break:break-word">${esc(preview)}</p>
    </section>
    <h2 class="section-title">3. Contagem anti-falso disparo</h2>
    <div class="filters">
      ${[5, 10, 15].map((sec) => `<button type="button" class="${db.sosSeconds === sec ? "on" : ""}" data-action="sos-sec" data-sec="${sec}">${sec} SEGUNDOS${sec === 10 ? " (PADRÃO)" : ""}</button>`).join("")}
    </div>
    <div class="form-grid">
      <button class="btn small" type="button" data-action="test-sos-beep"><span class="ms">campaign</span>TESTAR SIRENE</button>
      <button class="btn small navy" type="button" data-action="save-protocol"><span class="ms">check_circle</span>SALVAR E VOLTAR</button>
    </div>`;
  }

  function chartCard(chart, nm) {
    const asked = db.chmSaved[chart.id];
    const stamp = asked
      ? `Download pedido em ${new Date(asked).toLocaleString("pt-BR")}`
      : "O arquivo é baixado do site da Marinha para o seu aparelho.";
    return `<article class="card flat">
      <h3 style="margin:0">${esc(chart.id)} · ${esc(chart.title)}</h3>
      <p class="micro">Arquivo ${esc(chart.date)} · Aviso ${esc(chart.aviso)} · KAP ${esc(chart.kapSize)}</p>
      ${nm == null ? "" : `<p class="micro">Porto citado no título: ${nm.toFixed(0)} NM do GPS</p>`}
      <p class="micro" data-chart-stamp>${esc(stamp)}</p>
      <div class="chart-actions">
        <a class="btn small primary" href="${esc(chart.kap)}" target="_blank" rel="noopener noreferrer" data-action="note-chart" data-id="${esc(chart.id)}">BAIXAR KAP</a>
        <a class="btn small" href="${esc(chart.tif)}" target="_blank" rel="noopener noreferrer" data-action="note-chart" data-id="${esc(chart.id)}">GEOTIFF</a>
      </div>
      <p class="micro">O GeoTIFF (${esc(chart.tifSize)}) é material de estudo. Para navegar, use o KAP junto com a carta em papel atualizada.</p>
    </article>`;
  }

  function offlineHtml() {
    const packs = db.tilePacks;
    const progress = state.pack && state.pack.total ? Math.round((state.pack.done / state.pack.total) * 100) : 0;
    const pos = state.pos;
    const near = Charts.suggest(pos);
    const showingNear = state.chartFilter !== "all" && !!pos;
    const relaxed = state.chartFilter !== "all" && pos && !near.length;
    const rows = !showingNear
      ? Charts.list.map((chart) => ({ chart, nm: pos ? Geo.haversine(pos, chart.ref) / 1852 : null }))
      : (near.length ? near : Charts.nearest(pos));
    const note = !pos
      ? "Sem fix GNSS. A lista mostra o litoral entre Rio, Angra, São Sebastião e Santos."
      : relaxed
        ? "Nenhuma folha com porto de referência a menos de 40 NM. Estas são as mais próximas."
        : "A ordem usa a distância até o porto citado no título. Confira a folha no catálogo da Marinha.";
    return `<section class="card">
      <div class="micro">CARTAS RASTER DHN / CHM</div>
      <p>Download direto do site da Marinha. A carta raster não substitui a carta em papel atualizada pelo último Aviso aos Navegantes. Datum WGS-84. Estes arquivos não podem ser redistribuídos.</p>
      <a class="btn small" href="${esc(Charts.catalog)}" target="_blank" rel="noopener noreferrer">CATÁLOGO COMPLETO</a>
    </section>
    <div class="filters">
      <button type="button" class="${state.chartFilter !== "all" ? "on" : ""}" data-action="chart-filter" data-filter="near">PERTO DO GPS</button>
      <button type="button" class="${state.chartFilter === "all" ? "on" : ""}" data-action="chart-filter" data-filter="all">SUDESTE (${Charts.list.length})</button>
    </div>
    <p class="micro">${esc(note)}</p>
    <div class="list">
      ${rows.map((row) => chartCard(row.chart, showingNear || pos ? row.nm : null)).join("")}
    </div>
    <h2 class="section-title">Mapa de referência</h2>
    <p class="micro">OpenStreetMap neste navegador. Não é carta oficial e não substitui as folhas acima.</p>
    <section class="card stat-grid" style="display:grid">
      <div><span class="micro">NO CACHE</span><b id="cache-mb">${(state.cacheBytes / (1024 * 1024)).toFixed(1)}</b><span class="micro">MB</span></div>
      <div><span class="micro">ÁREAS</span><b>${packs.length}</b><span class="micro">BAIXADAS</span></div>
    </section>
    ${state.pack ? `<div class="progress"><span style="width:${progress}%"></span></div><p class="micro" id="pack-label">${state.pack.done}/${state.pack.total} tiles</p>` : ""}
    <button class="btn primary" type="button" data-action="download-radius" ${state.pack ? "disabled" : ""}>BAIXAR ÁREA AO REDOR DO GPS</button>
    <button class="btn small" type="button" data-action="clear-cache">APAGAR MAPA SALVO NESTE APARELHO</button>
    <h2 class="section-title">Áreas do mapa</h2>
    <div class="list">
      ${packs.map((pack) => `<article class="item"><div class="body"><h3>${esc(pack.name)}</h3><p>${pack.tiles} tiles · ${(pack.bytes / (1024 * 1024)).toFixed(1)} MB · ${new Date(pack.date).toLocaleString("pt-BR")}</p></div></article>`).join("") || `<p class="micro">Nenhuma área baixada. O mapa usa a rede até você salvar a região do passeio.</p>`}
    </div>`;
  }

  function visibleTrips() {
    const month = new Date().toISOString().slice(0, 7);
    return db.trips.filter((trip) => {
      if (state.filter === "fav") return trip.favorite;
      if (state.filter === "month") return String(trip.date).slice(0, 7) === month;
      return true;
    });
  }

  function historicoHtml() {
    const trips = visibleTrips();
    const totalNm = db.trips.reduce((sum, trip) => sum + (trip.nm || 0), 0);
    const maxKt = db.trips.reduce((max, trip) => Math.max(max, trip.maxKt || 0), 0);
    const hours = db.trips.reduce((sum, trip) => sum + (trip.minutes || 0), 0) / 60;
    return `<section class="stat-grid">
      <article class="card stat"><span class="micro">${db.trips.length} TRACKS</span><b>${totalNm.toFixed(1)}</b><span class="micro">NM GRAVADAS</span></article>
      <article class="card stat"><span class="micro">SOBRE A ÁGUA</span><b>${hours.toFixed(1)}</b><span class="micro">HORAS REGISTRADAS</span></article>
      <article class="card stat"><span class="micro">VEL. MÁXIMA</span><b>${db.trips.length ? maxKt.toFixed(1) : "—"}</b><span class="micro">KT</span></article>
      <article class="card stat"><span class="micro">PONTOS GNSS</span><b>${db.trips.reduce((sum, trip) => sum + (trip.pointsCount || 0), 0)}</b><span class="micro">NO DIÁRIO</span></article>
    </section>
    <div class="filters">
      <button type="button" class="${state.filter === "all" ? "on" : ""}" data-action="filter" data-filter="all">TODOS (${db.trips.length})</button>
      <button type="button" class="${state.filter === "month" ? "on" : ""}" data-action="filter" data-filter="month">ESTE MÊS</button>
      <button type="button" class="${state.filter === "fav" ? "on" : ""}" data-action="filter" data-filter="fav">FAVORITOS</button>
    </div>
    <div class="list">
      ${trips.map((trip) => `<article class="card flat">
        <div class="spread"><h3 style="margin:0">${esc(trip.name)}</h3><button class="icon-btn" type="button" data-action="fav" data-id="${trip.id}" aria-label="Favorito"><span class="ms ${trip.favorite ? "fill" : ""}">star</span></button></div>
        <p class="micro">${new Date(trip.date).toLocaleString("pt-BR")} · ${trip.minutes == null ? "duração não informada" : `${Math.floor(trip.minutes / 60)}h ${trip.minutes % 60}m`}</p>
        <div class="tiles">
          <article class="tile"><span class="micro">DIST.</span><b>${Number(trip.nm || 0).toFixed(1)}</b></article>
          <article class="tile"><span class="micro">MÉDIA</span><b>${trip.avgKt == null ? "—" : Number(trip.avgKt).toFixed(1)}</b></article>
          <article class="tile"><span class="micro">MÁX</span><b>${trip.maxKt == null ? "—" : Number(trip.maxKt).toFixed(1)}</b></article>
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn small primary" type="button" data-action="gpx-trip" data-id="${trip.id}">GPX</button>
          <button class="btn small" type="button" data-action="share-trip" data-id="${trip.id}">COMPARTILHAR</button>
        </div>
      </article>`).join("") || `<p class="micro">Nenhum passeio gravado. O diário começa quando você salvar um track do GPS.</p>`}
    </div>
    <button class="btn" type="button" data-action="save-current">SALVAR PASSEIO ATUAL</button>
    <button class="btn small" type="button" data-action="gpx-all">EXPORTAR TUDO</button>
    <label class="btn small">IMPORTAR GPX<input id="gpx-file" type="file" accept=".gpx,application/gpx+xml,.xml" hidden /></label>`;
  }

  const views = { cockpit: cockpitHtml, carta: cartaHtml, rotas: rotasHtml, sos: sosHtml, contatos: contatosHtml, offline: offlineHtml, historico: historicoHtml };

  function render(force) {
    headerEl.innerHTML = headerHtml();
    tabEl.innerHTML = navHtml();
    if (force || rendered !== state.screen) {
      if (rendered === "carta" || rendered === "rotas") NauticalMap.destroy();
      viewEl.innerHTML = views[state.screen]();
      rendered = state.screen;
      if (state.screen === "carta" || state.screen === "rotas") syncMap();
    }
    document.body.classList.toggle("strobe", state.strobe && state.screen === "sos");
    lockEl.hidden = !state.waterLock;
  }

  function patch() {
    const gpsChip = document.getElementById("gps-chip");
    if (gpsChip) gpsChip.textContent = gpsLabel();
    const sat = document.getElementById("sat-chip");
    if (sat) sat.innerHTML = `<span class="ms fill">satellite_alt</span> ${state.pos ? `± ${Math.round(state.pos.accuracy || 0)} M` : "—"}`;

    if (state.screen === "cockpit") {
      const hazard = nearestHazard();
      const alertKey = !state.pos
        ? `nofix:${state.gps}`
        : hazard && hazard.alert
          ? `${hazard.hazard.id}:${hazard.inside ? "in" : "buf"}`
          : `clear:${db.hazards.length ? 1 : 0}`;
      if (state.alertKey !== alertKey) {
        state.alertKey = alertKey;
        render(true);
        return;
      }
      if (hazard && hazard.alert) {
        const hTitle = document.getElementById("hazard-title");
        if (hTitle) hTitle.textContent = `${hazard.hazard.name.toUpperCase()} A ${Math.round(hazard.meters)} M`;
        const hSub = document.getElementById("hazard-sub");
        if (hSub) hSub.textContent = `${hazard.hazard.depth != null ? `PROF. INFORMADA ${Number(hazard.hazard.depth).toFixed(1)} M · ` : ""}MARCAÇÃO ${fmtDeg(hazard.bearingTo)} (${Geo.compass(hazard.bearingTo).short})`;
        const hBadge = document.getElementById("hazard-badge");
        if (hBadge) hBadge.textContent = `${Math.max(1, Math.round(hazard.seconds))}S`;
      }
      const sog = document.getElementById("sog");
      if (!sog) return;
      const sig = sogSignalStatus();
      const sogChip = document.getElementById("sog-chip");
      if (sogChip) {
        sogChip.className = sig.cls;
        sogChip.textContent = sig.text;
      }
      const cog = state.pos && state.pos.heading != null ? Geo.compass(state.pos.heading) : null;
      sog.textContent = fmtKt(state.pos && state.pos.knots);
      const kmh = document.getElementById("kmh");
      if (kmh) kmh.textContent = state.pos && state.pos.knots != null ? `${(state.pos.knots * 1.852).toFixed(0)} KM/H` : "KM/H —";
      const acc = document.getElementById("acc");
      if (acc) acc.textContent = state.pos ? `PRECISÃO ${Math.round(state.pos.accuracy || 0)} M` : "SEM FIX";
      document.getElementById("cog").textContent = fmtDeg(state.pos && state.pos.heading);
      document.getElementById("cog-name").textContent = cog ? cog.name : "—";
      const nm = state.distanceM / Geo.NM;
      document.getElementById("dist").textContent = nm.toFixed(2);
      const distKm = document.getElementById("dist-km");
      if (distKm) distKm.textContent = `NM · ${(nm * 1.852).toFixed(1)} KM`;
      document.getElementById("time").textContent = Geo.formatDuration(elapsedMs());
      const rec = document.getElementById("rec");
      if (rec) rec.textContent = !state.pos ? "SEM FIX" : (state.pos.accuracy || 999) > 40 ? "AGUARD. <=40M" : state.tracking ? "GRAVANDO" : "PAUSADO";
      const pts = document.getElementById("pts");
      if (pts) pts.textContent = `${state.track.length} PTS`;
      return;
    }
    if (state.screen === "carta" || state.screen === "rotas") {
      NauticalMap.update(mapData());
      state.frameChart = false;
      const route = activeRoute();
      const stats = routeStats(route);
      const lowAcc = state.pos && (state.pos.accuracy || 999) > 40;
      const sog = document.getElementById("carta-sog");
      if (sog) {
        sog.className = `chip ${lowAcc ? "warn" : ""}`;
        sog.textContent = lowAcc ? "SOG >40M" : `SOG ${fmtKt(state.pos && state.pos.knots)} KT`;
      }
      const cog = document.getElementById("carta-cog");
      if (cog) cog.textContent = `COG ${state.pos && state.pos.heading != null ? Math.round(state.pos.heading) + "°" : "—"}`;
      const followBtn = document.getElementById("carta-follow");
      if (followBtn) followBtn.className = `chip ${state.follow ? "live" : ""}`;
      const sheetBtn = document.getElementById("carta-sheet");
      if (sheetBtn) sheetBtn.className = `chip ${state.official && insideOfficial() ? "live" : ""}`;
      const caption = document.getElementById("carta-caption");
      if (caption) caption.textContent = cartaCaptionText();
      const alertBox = document.getElementById("carta-alert");
      if (alertBox) alertBox.innerHTML = cartaAlertHtml();
      if (route && route.waypoints.length) {
        const legIdx = Math.min(state.leg, route.waypoints.length - 1);
        const dest = route.waypoints[legIdx];
        const destName = document.getElementById("carta-dest-name");
        if (destName) destName.textContent = dest.name;
        const destLeg = document.getElementById("carta-dest-leg");
        if (destLeg) destLeg.textContent = `WP ${legIdx + 1}/${route.waypoints.length}`;
      }
      const nm = document.getElementById("carta-nm");
      if (nm) nm.textContent = stats.remainM == null ? "—" : (stats.remainM / Geo.NM).toFixed(1);
      const eta = document.getElementById("carta-eta");
      if (eta) eta.textContent = stats.etaMin == null ? "—" : String(Math.max(1, Math.round(stats.etaMin)));
      const hdg = document.getElementById("carta-hdg");
      if (hdg) hdg.textContent = fmtDeg(stats.cog);
      const hdgCard = document.getElementById("carta-hdg-cardinal");
      if (hdgCard) hdgCard.textContent = stats.cog == null ? "—" : Geo.compass(stats.cog).short;
    }
    if (state.screen === "sos") {
      const payload = buildSosPayload();
      const coord = document.getElementById("sos-coord");
      if (coord) coord.innerHTML = payload ? `${payload.latDms}<br>${payload.lonDms}` : "SEM FIX GNSS";
      const decEl = document.getElementById("sos-dec");
      if (decEl) decEl.textContent = payload ? `DEC: ${payload.dec}` : "AGUARDANDO SATÉLITES";
      const accChip = document.getElementById("sos-acc-chip");
      if (accChip) {
        accChip.className = `chip ${!payload ? "" : payload.acc > 40 ? "warn" : "live"}`;
        accChip.textContent = payload ? `± ${payload.acc} M` : gpsLabel();
      }
      const kinEl = document.getElementById("sos-kin");
      if (kinEl) {
        kinEl.textContent = !state.pos
          ? "Sem cinemática GNSS"
          : state.pos.knots != null
            ? `SOG ${state.pos.knots.toFixed(1)} KT · RUMO ${fmtDeg(state.pos.heading)} ${state.pos.heading != null ? Geo.compass(state.pos.heading).short : ""}`
            : `SINAL > 40M (±${payload.acc}M) · DERIVA / BAIXA PRECISÃO`;
      }
      const smsLink = document.getElementById("sos-sms-link");
      if (smsLink && payload) smsLink.setAttribute("href", payload.href);
      else if (!smsLink && payload && document.getElementById("sos-sms-disabled")) render(true);
    }
    if (state.screen === "contatos") {
      const previewEl = document.getElementById("sos-preview");
      const payload = buildSosPayload();
      if (previewEl) previewEl.textContent = payload ? payload.text : "A mensagem completa entra assim que houver fix GNSS.";
    }
  }

  function requireFix() {
    if (state.pos) return true;
    toast(state.gps === "denied" ? "Permissão de GPS negada." : "Ainda não há posição GNSS.");
    return false;
  }

  function armSos() {
    state.sos.phase = "counting";
    state.sos.remaining = db.sosSeconds;
    state.screen = "sos";
    playSosBeep("tick");
    render(true);
    if (navigator.vibrate) navigator.vibrate(80);
  }

  function finishSos() {
    state.sos.phase = "ready";
    state.strobe = true;
    playSosBeep("alarm");
    render(true);
    toast(state.pos ? "Alerta armado! Envie o SMS ou ligue 185." : "Alerta armado, ainda sem posição GNSS.");
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
  }

  function saveCurrentTrip() {
    if (state.track.length < 2) {
      toast("Grave um trecho com GPS antes de salvar.");
      return;
    }
    const nm = state.distanceM / Geo.NM;
    const minutes = Math.max(1, Math.round(elapsedMs() / 60000));
    const speeds = state.track.map((pt) => pt.knots).filter((value) => value != null);
    const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
    db.trips.unshift({
      id: `t${Date.now()}`,
      name: `Passeio ${new Date().toLocaleString("pt-BR")}`,
      date: new Date().toISOString(),
      minutes,
      nm: Number(nm.toFixed(2)),
      avgKt: avg == null ? null : Number(avg.toFixed(1)),
      maxKt: state.maxKt ? Number(state.maxKt.toFixed(1)) : null,
      pointsCount: state.track.length,
      favorite: false,
      points: state.track.slice(-2000)
    });
    state.track = [];
    state.distanceM = 0;
    state.maxKt = 0;
    state.startedAt = null;
    state.pausedMs = 0;
    state.pauseStarted = null;
    db.session = null;
    persist();
    toast("Passeio salvo no diário.");
    go("historico");
  }

  function gpxOf(points, name) {
    return Geo.buildGpx(points.map((pt) => ({
      lat: pt.lat, lon: pt.lon, knots: pt.knots, heading: pt.heading, altitude: 0, time: pt.time || Date.now()
    })), name);
  }

  async function holdWakeLock() {
    if (!navigator.wakeLock || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      if (wakeLock && wakeLock.addEventListener) {
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (err) {
      wakeLock = null;
    }
  }

  function startGps() {
    if (!navigator.geolocation) {
      state.gps = "unavailable";
      toast("Este navegador não expõe GPS.");
      render(true);
      return;
    }
    if (state.gpsWatch != null) navigator.geolocation.clearWatch(state.gpsWatch);
    state.gps = "searching";
    state.gpsWatch = navigator.geolocation.watchPosition((pos) => {
      const speed = pos.coords.speed;
      const knots = speed == null || speed < 0 ? null : speed * 1.943844;
      const heading = pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : null;
      const was = state.gps;
      pushPoint(pos.coords.latitude, pos.coords.longitude, knots, heading, pos.coords.accuracy || 0);
      if (was !== "live") {
        holdWakeLock();
        render(true);
      }
    }, (err) => {
      state.gps = err && err.code === 1 ? "denied" : "unavailable";
      render(true);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 });
  }

  function openMenu() {
    sheetEl.hidden = false;
    sheetEl.innerHTML = `<div class="sheet" role="dialog" aria-label="Menu">
      <div class="micro">JETSKINAV</div>
      <button class="btn small" type="button" data-action="go" data-screen="contatos">CONTATOS E VHF</button>
      <button class="btn small" type="button" data-action="go" data-screen="offline">CARTAS OFFLINE</button>
      <button class="btn small" type="button" data-action="go" data-screen="historico">HISTÓRICO E GPX</button>
      <button class="btn small primary" type="button" data-action="gps">REPETIR BUSCA GNSS</button>
      <button class="btn small" type="button" data-action="save-current">ENCERRAR E SALVAR PASSEIO</button>
      <button class="btn small navy" type="button" data-action="close-menu">FECHAR</button>
    </div>`;
  }

  function readMark() {
    const name = (document.getElementById("mark-name").value || "").trim();
    return name;
  }

  async function downloadArea() {
    if (!requireFix() || state.pack) return;
    state.pack = { done: 0, total: 1, bytes: 0 };
    render(true);
    try {
      const result = await NauticalMap.prefetch(state.pos.lat, state.pos.lon, (progress) => {
        state.pack = progress;
        const label = document.getElementById("pack-label");
        const bar = document.querySelector(".progress > span");
        if (label) label.textContent = `${progress.done}/${progress.total} tiles`;
        if (bar) bar.style.width = `${Math.round((progress.done / progress.total) * 100)}%`;
      });
      db.tilePacks.unshift({
        id: `p${Date.now()}`,
        name: `Área ${Geo.toDms(state.pos.lat, true)}`,
        tiles: result.tiles,
        bytes: result.bytes,
        date: new Date().toISOString()
      });
      persist();
      state.cacheBytes = await NauticalMap.cacheBytes();
      toast("Área salva no cache deste navegador.");
    } catch (err) {
      toast(err.message || "Não foi possível baixar a carta.");
    }
    state.pack = null;
    render(true);
  }

  function onClick(event) {
    holdWakeLock();
    const el = event.target.closest("[data-action]");
    if (!el) {
      if (event.target === sheetEl) sheetEl.hidden = true;
      return;
    }
    const action = el.dataset.action;
    if (state.waterLock && action !== "unlock") {
      if (el.tagName === "A") event.preventDefault();
      return;
    }
    if (action === "go") { sheetEl.hidden = true; go(el.dataset.screen); return; }
    if (action === "back") return go(state.back || "cockpit");
    if (action === "menu") return openMenu();
    if (action === "close-menu") { sheetEl.hidden = true; return; }
    if (action === "lock") { state.waterLock = true; lockEl.hidden = false; return; }
    if (action === "unlock") { state.waterLock = false; lockEl.hidden = true; if (navigator.vibrate) navigator.vibrate(40); return; }
    if (action === "toggle-track") {
      state.tracking = !state.tracking;
      if (state.tracking) {
        if (state.pauseStarted) state.pausedMs += Date.now() - state.pauseStarted;
        state.pauseStarted = null;
        if (!state.startedAt && state.pos && (state.pos.accuracy || 999) <= 40) state.startedAt = Date.now();
      } else state.pauseStarted = Date.now();
      saveSession();
      render(true);
      return;
    }
    if (action === "layer") {
      if (el.dataset.layer === "official") state.official = !state.official;
      if (el.dataset.layer === "seamarks") state.seamarks = !state.seamarks;
      if (el.dataset.layer === "track") state.showTrack = !state.showTrack;
      const bOff = document.getElementById("layer-official");
      if (bOff) { bOff.className = state.official ? "on" : ""; bOff.setAttribute("aria-pressed", String(state.official)); bOff.textContent = state.official ? "1636" : "OSM"; }
      const bSea = document.getElementById("layer-seamarks");
      if (bSea) { bSea.className = state.seamarks ? "on" : ""; bSea.setAttribute("aria-pressed", String(state.seamarks)); bSea.textContent = state.seamarks ? "SEA" : "sea"; }
      const bTrk = document.getElementById("layer-track");
      if (bTrk) { bTrk.className = state.showTrack ? "on" : ""; bTrk.setAttribute("aria-pressed", String(state.showTrack)); bTrk.textContent = state.showTrack ? "TR" : "tr"; }
      patch();
      return;
    }
    if (action === "frame-chart") {
      state.official = true;
      state.follow = false;
      state.frameChart = true;
      const bOff = document.getElementById("layer-official");
      if (bOff) { bOff.className = "on"; bOff.setAttribute("aria-pressed", "true"); bOff.textContent = "1636"; }
      patch();
      return;
    }
    if (action === "recenter") {
      if (!requireFix()) return;
      state.follow = true;
      NauticalMap.recenter(state.pos);
      patch();
      return;
    }
    if (action === "focus-mark") {
      const lat = Number(el.dataset.lat);
      const lon = Number(el.dataset.lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        state.follow = false;
        NauticalMap.focus(lat, lon, 16);
        patch();
      }
      return;
    }
    if (action === "del-hazard") {
      db.hazards = db.hazards.filter((h) => h.id !== el.dataset.id);
      persist();
      const title = document.getElementById("carta-marks-title");
      if (title) title.textContent = `Pontos marcados (${db.hazards.length + db.pois.length})`;
      const marks = document.getElementById("carta-marks");
      if (marks) marks.innerHTML = cartaMarksHtml();
      patch();
      toast("Baixio removido.");
      return;
    }
    if (action === "del-poi") {
      db.pois = db.pois.filter((p) => p.id !== el.dataset.id);
      persist();
      const title = document.getElementById("carta-marks-title");
      if (title) title.textContent = `Pontos marcados (${db.hazards.length + db.pois.length})`;
      const marks = document.getElementById("carta-marks");
      if (marks) marks.innerHTML = cartaMarksHtml();
      patch();
      toast("POI removido.");
      return;
    }
    if (action === "mark-poi" || action === "mark-hazard") {
      if (!requireFix()) return;
      const name = readMark() || (action === "mark-poi" ? `POI ${db.pois.length + 1}` : `Baixio ${db.hazards.length + 1}`);
      const point = { name, lat: Number(state.pos.lat.toFixed(5)), lon: Number(state.pos.lon.toFixed(5)) };
      const acc = Math.round(state.pos.accuracy || 0);
      const accWarn = acc > 40 ? ` (precisão ±${acc}m)` : "";
      if (action === "mark-hazard") {
        const depthRaw = document.getElementById("mark-depth").value;
        const rawRadius = Number(document.getElementById("mark-radius").value) || 80;
        const radius = Math.max(15, Math.min(2000, rawRadius));
        const depth = depthRaw === "" ? null : Math.max(0, Number(depthRaw));
        db.hazards.push({ ...point, id: `h${Date.now()}`, radius, depth });
        toast(`Baixio marcado na posição GNSS${accWarn}.`);
      } else {
        db.pois.push({ ...point, id: `p${Date.now()}` });
        toast(`POI marcado na posição GNSS${accWarn}.`);
      }
      persist();
      const nameInput = document.getElementById("mark-name");
      if (nameInput) nameInput.value = "";
      const depthInput = document.getElementById("mark-depth");
      if (depthInput) depthInput.value = "";
      const title = document.getElementById("carta-marks-title");
      if (title) title.textContent = `Pontos marcados (${db.hazards.length + db.pois.length})`;
      const marks = document.getElementById("carta-marks");
      if (marks) marks.innerHTML = cartaMarksHtml();
      patch();
      return;
    }
    if (action === "new-route") {
      const route = { id: `r${Date.now()}`, name: `Rota ${db.routes.length + 1}`, waypoints: [] };
      db.routes.unshift(route);
      db.activeRouteId = route.id;
      state.leg = 0;
      persist();
      render(true);
      toast("Nova rota criada.");
      return;
    }
    if (action === "del-route") {
      const route = activeRoute();
      if (!route) return;
      if (db.routes.length > 1) {
        db.routes = db.routes.filter((r) => r.id !== route.id);
        db.activeRouteId = db.routes[0].id;
        toast("Rota excluída.");
      } else {
        route.waypoints = [];
        route.name = "Nova rota";
        toast("Waypoints da rota limpos.");
      }
      state.leg = 0;
      persist();
      render(true);
      return;
    }
    if (action === "toggle-tap-wp") {
      state.mapTapWp = !state.mapTapWp;
      patchRotas();
      toast(state.mapTapWp ? "Toque no mini-mapa para adicionar waypoints." : "Toque no mini-mapa desativado.");
      return;
    }
    if (action === "fit-route") {
      const route = activeRoute();
      if (route && route.waypoints.length) {
        state.fitRoute = true;
        patchRotas();
      } else {
        state.frameChart = true;
        patchRotas();
        state.frameChart = false;
      }
      return;
    }
    if (action === "reverse-route") {
      const route = activeRoute();
      if (!route || route.waypoints.length < 2) { toast("Adicione ao menos 2 waypoints para inverter."); return; }
      route.waypoints.reverse();
      state.leg = 0;
      state.fitRoute = true;
      persist();
      patchRotas();
      toast("Sentido da rota invertido.");
      return;
    }
    if (action === "move-wp") {
      const route = activeRoute();
      if (!route) return;
      const idx = Number(el.dataset.index);
      const dir = Number(el.dataset.dir);
      const target = idx + dir;
      if (target < 0 || target >= route.waypoints.length) return;
      const tmp = route.waypoints[idx];
      route.waypoints[idx] = route.waypoints[target];
      route.waypoints[target] = tmp;
      state.leg = 0;
      persist();
      patchRotas();
      return;
    }
    if (action === "focus-wp") {
      const lat = Number(el.dataset.lat);
      const lon = Number(el.dataset.lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) NauticalMap.focus(lat, lon, 15);
      return;
    }
    if (action === "add-wp-poi") {
      const poi = db.pois.find((p) => p.id === el.dataset.id);
      if (!poi) return;
      const route = ensureRoute();
      route.waypoints.push({ name: poi.name, lat: poi.lat, lon: poi.lon });
      state.fitRoute = true;
      persist();
      patchRotas();
      toast(`POI "${poi.name}" incluído na rota.`);
      return;
    }
    if (action === "add-wp-here" || action === "add-wp-dest") {
      if (!requireFix()) return;
      const route = ensureRoute();
      const nameInput = document.getElementById("wp-name");
      const name = ((nameInput && nameInput.value) || `Waypoint ${route.waypoints.length + 1}`).trim();
      const point = { name, lat: Number(state.pos.lat.toFixed(5)), lon: Number(state.pos.lon.toFixed(5)) };
      const acc = Math.round(state.pos.accuracy || 0);
      const accWarn = acc > 40 ? ` (precisão ±${acc}m)` : "";
      if (action === "add-wp-dest" || !route.waypoints.length) route.waypoints.push(point);
      else route.waypoints.splice(route.waypoints.length - 1, 0, point);
      if (nameInput) nameInput.value = "";
      state.fitRoute = true;
      persist();
      patchRotas();
      toast(`Waypoint adicionado${accWarn}.`);
      return;
    }
    if (action === "del-wp") {
      const route = activeRoute();
      if (!route) return;
      route.waypoints.splice(Number(el.dataset.index), 1);
      state.leg = 0;
      persist();
      patchRotas();
      return;
    }
    if (action === "start-route") {
      const route = activeRoute();
      if (!route || !route.waypoints.length) { toast("A rota precisa de um waypoint."); return; }
      state.leg = 0;
      state.follow = true;
      state.tracking = true;
      saveSession();
      toast(`Navegando: ${route.name}`);
      go("carta");
      return;
    }
    if (action === "save-route") { persist(); toast("Rota salva neste aparelho."); return; }
    if (action === "gpx-route") {
      const route = activeRoute();
      if (!route || !route.waypoints.length) { toast("A rota não tem pontos."); return; }
      Geo.download(`${route.name}.gpx`, Geo.buildRouteGpx(route.waypoints, route.name));
      toast("GPX da rota baixado.");
      return;
    }
    if (action === "arm-sos") return armSos();
    if (action === "cancel-sos") {
      state.sos.phase = "idle";
      state.strobe = false;
      render(true);
      toast("Alerta SOS encerrado.");
      return;
    }
    if (action === "copy-coord") {
      const payload = buildSosPayload();
      if (!payload) { toast("Sem posição para copiar."); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(payload.text).then(() => toast("Coordenadas e link do mapa copiados."));
      else toast(payload.text);
      return;
    }
    if (action === "share-sos") {
      const payload = buildSosPayload();
      if (!payload) { toast("Sem posição para compartilhar."); return; }
      if (navigator.share) {
        navigator.share({ title: "SOS JetSkiNav", text: payload.text, url: payload.maps }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(payload.text).then(() => toast("Mensagem SOS copiada para colar no WhatsApp/SMS."));
      } else {
        toast(payload.text);
      }
      return;
    }
    if (action === "strobe") {
      state.strobe = !state.strobe;
      if (state.strobe) playSosBeep("alarm");
      render(true);
      return;
    }
    if (action === "toggle-vhf") {
      db.vhf.audible = !db.vhf.audible;
      persist();
      if (db.vhf.audible) playSosBeep("tick");
      const btn = document.getElementById("btn-toggle-vhf");
      if (btn) {
        btn.className = `btn small ${db.vhf.audible ? "primary" : ""}`;
        btn.innerHTML = `<span class="ms">${db.vhf.audible ? "volume_up" : "volume_off"}</span>ALARME SONORO DE EMERGÊNCIA: ${db.vhf.audible ? "LIGADO" : "DESLIGADO"}`;
      }
      return;
    }
    if (action === "test-sos-beep") {
      const prev = db.vhf.audible;
      db.vhf.audible = true;
      playSosBeep("alarm");
      db.vhf.audible = prev;
      toast("Sirene acústica testada.");
      return;
    }
    if (action === "add-contact") {
      const nameEl = document.getElementById("c-name");
      const phoneEl = document.getElementById("c-phone");
      const name = (nameEl && nameEl.value || "").trim();
      const phone = (phoneEl && phoneEl.value || "").trim();
      const digits = cleanPhone(phone).replace(/\D/g, "");
      if (!name || digits.length < 3) { toast("Informe nome e um telefone válido."); return; }
      db.contacts.push({ id: `c${Date.now()}`, name, phone, priority: db.contacts.length + 1 });
      persist();
      if (nameEl) nameEl.value = "";
      if (phoneEl) phoneEl.value = "";
      const listEl = document.getElementById("contatos-list");
      if (listEl) listEl.innerHTML = contatosListHtml();
      const titleEl = document.getElementById("contatos-title");
      if (titleEl) titleEl.textContent = `2. Contatos de resgate (${db.contacts.length})`;
      toast("Contato de resgate incluído.");
      return;
    }
    if (action === "move-contact") {
      const idx = Number(el.dataset.index);
      const dir = Number(el.dataset.dir);
      const target = idx + dir;
      if (target < 0 || target >= db.contacts.length) return;
      const tmp = db.contacts[idx];
      db.contacts[idx] = db.contacts[target];
      db.contacts[target] = tmp;
      db.contacts.forEach((c, i) => { c.priority = i + 1; });
      persist();
      const listEl = document.getElementById("contatos-list");
      if (listEl) listEl.innerHTML = contatosListHtml();
      toast(`Prioridade P1: ${db.contacts[0].name}`);
      return;
    }
    if (action === "del-contact") {
      db.contacts = db.contacts.filter((contact) => contact.id !== el.dataset.id);
      db.contacts.forEach((contact, index) => { contact.priority = index + 1; });
      persist();
      const listEl = document.getElementById("contatos-list");
      if (listEl) listEl.innerHTML = contatosListHtml();
      const titleEl = document.getElementById("contatos-title");
      if (titleEl) titleEl.textContent = `2. Contatos de resgate (${db.contacts.length})`;
      return;
    }
    if (action === "sos-sec") {
      db.sosSeconds = Number(el.dataset.sec);
      if (state.sos.phase === "idle") state.sos.remaining = db.sosSeconds;
      persist();
      document.querySelectorAll('[data-action="sos-sec"]').forEach((b) => {
        b.className = Number(b.dataset.sec) === db.sosSeconds ? "on" : "";
      });
      toast(`Contagem SOS ajustada para ${db.sosSeconds}s.`);
      return;
    }
    if (action === "save-protocol") {
      const marina = document.getElementById("vhf-marina");
      if (marina) db.vhf.marina = marina.value.trim();
      persist();
      toast("Protocolos salvos.");
      go("sos");
      return;
    }
    if (action === "chart-filter") { state.chartFilter = el.dataset.filter; render(true); return; }
    if (action === "note-chart") {
      db.chmSaved[el.dataset.id] = Date.now();
      persist();
      const stamp = el.closest("article") && el.closest("article").querySelector("[data-chart-stamp]");
      if (stamp) stamp.textContent = `Download pedido em ${new Date(db.chmSaved[el.dataset.id]).toLocaleString("pt-BR")}`;
      toast("O arquivo abre no site da Marinha.");
      return;
    }
    if (action === "download-radius") { downloadArea(); return; }
    if (action === "clear-cache") {
      NauticalMap.clearCache().then(async () => {
        db.tilePacks = [];
        persist();
        state.cacheBytes = 0;
        toast("Mapa salvo neste aparelho foi apagado.");
        render(true);
      });
      return;
    }
    if (action === "filter") { state.filter = el.dataset.filter; render(true); return; }
    if (action === "fav") {
      const trip = db.trips.find((item) => item.id === el.dataset.id);
      if (trip) trip.favorite = !trip.favorite;
      persist();
      render(true);
      return;
    }
    if (action === "gpx-trip" || action === "share-trip") {
      const trip = db.trips.find((item) => item.id === el.dataset.id);
      if (!trip) return;
      const text = `${trip.name}: ${trip.nm} NM`;
      if (action === "share-trip" && navigator.share) {
        navigator.share({ title: trip.name, text }).catch(() => {});
        return;
      }
      Geo.download(`${trip.name}.gpx`, gpxOf(trip.points || [], trip.name));
      toast("GPX baixado.");
      return;
    }
    if (action === "gpx-all") {
      if (!db.trips.length) { toast("Não há tracks para exportar."); return; }
      Geo.download("jetskinav-tracks.gpx", Geo.buildMultiGpx(db.trips.map((trip) => ({
        name: trip.name,
        points: trip.points || []
      }))));
      toast("Arquivo com todos os tracks baixado.");
      return;
    }
    if (action === "save-current") { sheetEl.hidden = true; saveCurrentTrip(); return; }
    if (action === "gps") { sheetEl.hidden = true; startGps(); render(true); }
  }

  function onInput(event) {
    const field = event.target.dataset.field;
    if (!field) return;
    if (field === "route-name") {
      const route = activeRoute();
      if (route) route.name = event.target.value;
      persist();
      patchRotas();
      return;
    }
    if (field === "vhf") { db.vhf.marina = event.target.value; persist(); return; }
    const value = Number(event.target.value);
    if (Number.isNaN(value)) return;
    if (field === "reserve") db.settings.reserve = Math.min(0.8, Math.max(0, value / 100));
    else if (field === "draftM") db.settings.draftM = Math.max(0.1, Math.min(10, value));
    else if (field === "tankL") db.settings.tankL = Math.max(1, Math.min(2000, value));
    else if (field === "cruiseKt") db.settings.cruiseKt = Math.max(1, Math.min(100, value));
    else if (field === "lph") db.settings.lph = Math.max(0.1, Math.min(500, value));
    else db.settings[field] = value;
    persist();
    patchRotas();
  }

  function onRouteGpxFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const points = Geo.parseGpx(String(reader.result));
      if (!points.length) { toast("GPX sem pontos reconhecíveis."); return; }
      const route = ensureRoute();
      const sampled = points.length > 40
        ? points.filter((_, idx) => idx === 0 || idx === points.length - 1 || idx % Math.ceil(points.length / 25) === 0)
        : points;
      route.name = file.name.replace(/\.gpx$/i, "") || route.name;
      route.waypoints = sampled.map((pt, idx) => ({
        name: pt.name || `WP ${idx + 1}`,
        lat: Number(pt.lat.toFixed(5)),
        lon: Number(pt.lon.toFixed(5))
      }));
      state.leg = 0;
      state.fitRoute = true;
      persist();
      render(true);
      toast(`Rota importada com ${route.waypoints.length} waypoints.`);
    };
    reader.readAsText(file);
  }

  function onFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const points = Geo.parseGpx(String(reader.result));
      if (points.length < 2) { toast("GPX sem trilha reconhecível."); return; }
      const nm = Geo.pathLength(points) / Geo.NM;
      db.trips.unshift({
        id: `t${Date.now()}`,
        name: file.name.replace(/\.gpx$/i, ""),
        date: new Date().toISOString(),
        minutes: null,
        nm: Number(nm.toFixed(2)),
        avgKt: null,
        maxKt: null,
        pointsCount: points.length,
        favorite: false,
        points
      });
      persist();
      toast("Trilha importada. Velocidade só entra se o arquivo trouxer.");
      render(true);
    };
    reader.readAsText(file);
  }

  let holdTimer = null;
  function startHold(event) {
    const el = event.target.closest("[data-hold='sos']");
    if (!el || state.waterLock) return;
    holdWakeLock();
    if (el.setPointerCapture && event.pointerId != null) {
      try { el.setPointerCapture(event.pointerId); } catch (_) {}
    }
    state.sos.hold = 0;
    clearInterval(holdTimer);
    holdTimer = setInterval(() => {
      state.sos.hold += 50;
      const bar = document.getElementById("hold-bar");
      if (bar) bar.style.width = `${Math.min(100, (state.sos.hold / 3000) * 100)}%`;
      if (state.sos.hold >= 3000) {
        clearInterval(holdTimer);
        armSos();
      }
    }, 50);
  }
  function endHold() {
    clearInterval(holdTimer);
    state.sos.hold = 0;
    const bar = document.getElementById("hold-bar");
    if (bar) bar.style.width = "0%";
  }

  function tick() {
    if (state.sos.phase === "counting") {
      state.sos.remaining -= 1;
      if (state.sos.remaining <= 0) finishSos();
      else {
        playSosBeep("tick");
        const count = document.getElementById("sos-count");
        if (count) count.textContent = String(state.sos.remaining);
      }
    } else if (state.sos.phase === "ready" && state.strobe) {
      playSosBeep("tick");
    }
    patch();
  }

  function boot() {
    document.body.addEventListener("click", onClick);
    document.body.addEventListener("input", onInput);
    document.body.addEventListener("change", (event) => {
      if (event.target.id === "gpx-file") onFile(event);
      if (event.target.id === "gpx-route-file") onRouteGpxFile(event);
      if (event.target.id === "route-select") {
        db.activeRouteId = event.target.value;
        state.leg = 0;
        state.fitRoute = true;
        persist();
        render(true);
      }
    });
    document.body.addEventListener("contextmenu", (event) => {
      if (event.target.closest("[data-hold='sos']")) event.preventDefault();
    });
    document.body.addEventListener("pointerdown", startHold);
    document.body.addEventListener("pointerup", endHold);
    document.body.addEventListener("pointercancel", endHold);
    document.body.addEventListener("lostpointercapture", endHold);
    window.addEventListener("blur", endHold);
    if (navigator.getBattery) {
      navigator.getBattery().then((battery) => {
        const syncBattery = () => {
          state.battery = Math.round(battery.level * 100);
          render(false);
        };
        syncBattery();
        if (battery.addEventListener) battery.addEventListener("levelchange", syncBattery);
      }).catch(() => {});
    }
    NauticalMap.cacheBytes().then((bytes) => { state.cacheBytes = bytes; if (state.screen === "offline") render(true); }).catch(() => {});
    render(true);
    startGps();
    setInterval(tick, 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") holdWakeLock(); });
  }

  boot();
  return { state, db };
})();
