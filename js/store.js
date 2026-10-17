const Store = (() => {
  const KEY = "jetskinav-v2";

  function blank() {
    return {
      contacts: [],
      vhf: { marina: "", audible: true },
      sosSeconds: 10,
      settings: { draftM: 0.4, reserve: 0.35, tankL: 60, cruiseKt: 25, lph: 18 },
      activeRouteId: null,
      pois: [],
      hazards: [],
      routes: [],
      tilePacks: [],
      trips: [],
      chmSaved: {},
      session: null
    };
  }

  function load() {
    localStorage.removeItem("jetskinav-v1");
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const saved = JSON.parse(raw);
      const base = blank();
      return {
        ...base,
        ...saved,
        settings: { ...base.settings, ...(saved.settings || {}) },
        vhf: { ...base.vhf, ...(saved.vhf || {}) },
        contacts: saved.contacts || [],
        pois: saved.pois || [],
        hazards: saved.hazards || [],
        routes: saved.routes || [],
        tilePacks: saved.tilePacks || [],
        trips: saved.trips || [],
        chmSaved: saved.chmSaved || {},
        session: saved.session || null
      };
    } catch (err) {
      return blank();
    }
  }

  function save(data) {
    const copy = { ...data };
    localStorage.setItem(KEY, JSON.stringify(copy));
  }

  return { KEY, load, save, blank };
})();
