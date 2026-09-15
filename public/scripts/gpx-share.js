// Centralized GPX sharing / handoff utilities
(function(){
  // Register service worker and listen for shared GPX messages
  async function registerServiceWorker() {
    // The native shell receives shared files through the MeteoRideShare plugin,
    // so the service worker handoff is neither available nor needed there.
    if (window.CW_NATIVE) return;
    if (!('serviceWorker' in navigator)) return;
    // Listening before registering: the worker posts as soon as it has stored a route.
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'cw-shared-gpx') takeSharedFromServiceWorker();
    });
    try {
      await navigator.serviceWorker.register('/scripts/service-worker.js');
    } catch (err) {
      console.warn('[cw] sw register failed', err);
    }
  }

  // Confirming a route draws it onto the Leaflet map, and routes from outside routinely
  // arrive before app.js has built it: the native inbox at boot, the service worker,
  // sessionStorage, ?gpx_url=. One wait shared by every read that needs it.
  let mapReady = null;
  function whenMapReady() {
    if (!mapReady) {
      mapReady = new Promise((resolve) => {
        const ready = () => !!window.map && typeof window.cwParseRoute === 'function';
        if (ready()) return resolve();
        const timer = setInterval(() => { if (ready()) { clearInterval(timer); resolve(); } }, 100);
      });
    }
    return mapReady;
  }

  // Every route from outside the page arrives here. Its request is made at once, before any
  // wait; the download and the wait for the map happen inside its read, under its deadline.
  // Keeping the route among the recent ones is separate from which route ends up on screen:
  // a share is imported as its text arrives, whatever its request ends as; a link or a
  // message only once it is the route confirmed. The download starts with the request
  // rather than in its read, because a request replaced in the same tick never reads, and
  // its import must not depend on that. Resolves with what the request ends as.
  function cwReceiveRoute({ source, name, text, fetchText, importOn = source === 'url' || source === 'message' ? 'commit' : 'arrival' }) {
    const routeName = name || 'Shared route';
    const arrived = text != null ? Promise.resolve(String(text)) : Promise.resolve().then(fetchText);
    arrived.catch(() => {});   // the read reports it; a replaced request never reads
    const status = window.cw.requestRoute({
      source,
      read: async () => {
        const got = await arrived;
        if (!got) throw new Error('no route text');
        await whenMapReady();
        return { text: got, name: routeName };
      },
    });
    const importIt = (got) => { if (got) window.cwImportIfRoute(got, routeName); };
    if (importOn === 'arrival') arrived.then(importIt, () => {});
    else status.then((s) => { if (s === 'committed') arrived.then(importIt); });
    return status;
  }

  window.cwReceiveRoute = cwReceiveRoute;

  function cwInjectGPXFromText(text, name, source = 'share-native') {
    return cwReceiveRoute({ source, name, text });
  }

  // leaflet-gpx builds waypoint popups by concatenating the <name> and <desc> text
  // straight into an HTML string, so a route carrying markup there runs it in our
  // origin — where the provider API key lives, and in the app where the Capacitor
  // bridge lives. Escaping those text nodes before the library sees them keeps the
  // text visible and inert, and does not touch anything else in the file.
  function escapeMarkup(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const RISKY_TEXT_NODES = [
    'wpt > name', 'wpt > desc', 'wpt > cmt',
    'trk > name', 'trk > desc',
    'rte > name', 'rte > desc',
    'metadata > name', 'metadata > desc'
  ].join(', ');

  function cwSanitizeGPXText(gpxText) {
    const original = String(gpxText || '');
    try {
      const doc = new DOMParser().parseFromString(original, 'application/xml');
      // Leave broken XML alone; the loader reports it far better than we could.
      if (doc.getElementsByTagName('parsererror').length) return original;

      let changed = false;
      doc.querySelectorAll(RISKY_TEXT_NODES).forEach((el) => {
        const text = el.textContent || '';
        const safe = escapeMarkup(text);
        if (safe !== text) {
          el.textContent = safe;
          changed = true;
        }
      });
      // Only re-serialise when something actually needed escaping, so ordinary
      // routes reach the parser byte for byte as they arrived.
      return changed ? new XMLSerializer().serializeToString(doc) : original;
    } catch (e) {
      console.warn('[cw] GPX sanitise failed, passing through', e);
      return original;
    }
  }

  window.cwSanitizeGPXText = cwSanitizeGPXText;

  // Parse GPX text and return a small summary object for easier debugging
  function parseGPXSummary(gpxText) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(String(gpxText || ''), 'application/xml');
      const parseError = doc.getElementsByTagName('parsererror');
      if (parseError && parseError.length) return { error: 'invalid-xml' };

      const getText = (el, sel) => {
        try { const n = el.querySelector(sel); return n ? (n.textContent || '').trim() : null; } catch(_) { return null; }
      };

      const name = getText(doc, 'name') || getText(doc, 'metadata > name') || null;
      const wpts = doc.getElementsByTagName('wpt').length || 0;
      const trkpts = doc.getElementsByTagName('trkpt').length || 0;

      // times
      const times = Array.from(doc.getElementsByTagName('time')).map(n => (n.textContent || '').trim()).filter(Boolean);
      const firstTime = times.length ? times[0] : null;
      const lastTime = times.length ? times[times.length - 1] : null;

      // bbox from trkpt or wpt
      let minLat=90, minLon=180, maxLat=-90, maxLon=-180, found=false;
      const pts = doc.getElementsByTagName('trkpt');
      if (pts.length === 0) {
        // fallback to waypoints
        const w = doc.getElementsByTagName('wpt');
        for (let i=0;i<w.length;i++){
          const el = w[i];
          const lat = parseFloat(el.getAttribute('lat')||NaN);
          const lon = parseFloat(el.getAttribute('lon')||NaN);
          if (!isNaN(lat) && !isNaN(lon)) { found=true; minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat); minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon); }
        }
      } else {
        for (let i=0;i<pts.length;i++){
          const el = pts[i];
          const lat = parseFloat(el.getAttribute('lat')||NaN);
          const lon = parseFloat(el.getAttribute('lon')||NaN);
          if (!isNaN(lat) && !isNaN(lon)) { found=true; minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat); minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon); }
        }
      }

      const bbox = found ? { minLat, minLon, maxLat, maxLon } : null;

      return { name, wpts, trkpts, firstTime, lastTime, bbox };
    } catch (e) {
      return { error: 'parse-failed' };
    }
  }

  function logGPXSummary(gpxText, name){
    try {
      const s = parseGPXSummary(gpxText);
      const title = name || s.name || 'shared.gpx';
      const out = ['GPX:', title, 'trkpts=' + (s.trkpts ?? 0), 'wpts=' + (s.wpts ?? 0)];
      if (s.firstTime) out.push('start=' + s.firstTime);
      if (s.lastTime) out.push('end=' + s.lastTime);
      if (s.bbox) out.push('bbox=' + [s.bbox.minLat.toFixed(5), s.bbox.minLon.toFixed(5), s.bbox.maxLat.toFixed(5), s.bbox.maxLon.toFixed(5)].join(','));
      if (window.logdebug) window.logdebug(out.join(' | ')); else console.log(out.join(' | '));
      return s;
    } catch(_) { if (window.logdebug) window.logdebug('GPX: (unreadable)'); else console.log('GPX: (unreadable)'); }
  }

  // Takes the route the service worker stored in IndexedDB, if any: read and delete in one
  // readwrite transaction, settled only once it completes. Resolves null when there is none.
  function readSharedGPXFromIDB() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const req = indexedDB.open('cw_shared_db', 1);
      req.onupgradeneeded = (evt) => {
        try { evt.target.result.createObjectStore('files'); } catch(_) {}
      };
      req.onsuccess = (evt) => {
        try {
          const db = evt.target.result;
          const tx = db.transaction('files', 'readwrite');
          const store = tx.objectStore('files');
          const done = (val) => { try { db.close(); } catch(_) {} ; resolve(val); };
          tx.onabort = () => done(null);
          const gt = store.get('gpx');
          gt.onsuccess = () => {
            const val = gt.result || null;
            if (val) store.delete('gpx');
            tx.oncomplete = () => done(val);
          };
          gt.onerror = () => done(null);
        } catch (err) { resolve(null); }
      };
      req.onerror = () => resolve(null);
    });
  }

  // The one reader of the service worker's slot, which holds a single route. One read at a
  // time: a call while a read runs makes that read go round once more when it ends, so a route
  // stored meanwhile, whose message found the reader busy, is still taken, and no route is
  // taken twice. Called at start-up (which covers ?shared, where the worker sends the page)
  // and on every cw-shared-gpx message.
  // ponytail: a slot transaction that never settles stalls the reader for the page's life,
  // like the recent-routes queue; a timeout per read would unstick it.
  let slotRead = null;
  let slotAgain = false;

  function takeSharedFromServiceWorker() {
    if (slotRead) {
      slotAgain = true;
      return slotRead;
    }
    slotRead = (async () => {
      try {
        do {
          slotAgain = false;
          const payload = await readSharedGPXFromIDB();
          if (payload && payload.text) {
            cwReceiveRoute({ source: 'share-sw', name: payload.name, text: payload.text, importOn: 'arrival' });
          }
        } while (slotAgain);
      } finally {
        slotRead = null;
      }
    })();
    return slotRead;
  }

  // sessionStorage handoff (keeps existing behavior for open-in from other pages)
  function sessionStorageHandoff() {
    try {
      const KEY = 'cw_gpx_text';
      const KEY_NAME = 'cw_gpx_name';
      const ss = window.sessionStorage;
      const pending = ss ? ss.getItem(KEY) : null;
      if (pending) {
        const routeName = ss.getItem(KEY_NAME) || 'Shared route';
        ss.removeItem(KEY);
        ss.removeItem(KEY_NAME);
        cwReceiveRoute({ source: 'share-session', name: routeName, text: pending, importOn: 'arrival' });
        console.log('[cw] loaded GPX from sessionStorage');
        if (window.openDebug) window.openDebug();
      }
    } catch(e){ console.warn('[cw] sessionStorage unavailable', e); }
  }

  // --- Minimal URL param ingest (moved from gpx-ingest.js) ---
  function getParams() {
    const q = new URLSearchParams(window.location.search || "");
    const hstr = (window.location.hash || "").replace(/^#/, "");
    const h = new URLSearchParams(hstr);
    const get = (k) => h.get(k) ?? q.get(k) ?? null;
    return {
      gpxUrl: get("gpx_url") || get("url"),
      name: get("name") || "Shared route"
    };
  }

  async function fetchText(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  // A hosted route is downloaded inside its request, so a route picked while it downloads is
  // the later request and wins. What is not a GPX (a login page, say) fails the request with a
  // notice. It is kept among recent routes only once confirmed.
  function loadFromParams() {
    const { gpxUrl, name } = getParams();
    if (!gpxUrl) return;
    cwReceiveRoute({
      source: 'url',
      name,
      importOn: 'commit',
      fetchText: async () => {
        const txt = await fetchText(gpxUrl);
        if (!txt || !txt.includes("<gpx")) throw new Error("Fetched content is not GPX");
        return txt;
      },
    });
  }

  // A route /share keeps for two minutes. Its request is made as the download starts; it is
  // kept among recent routes as soon as its text arrives, whatever the request ends as, and the
  // server copy is deleted then, without waiting for the answer.
  function loadSharedIdIfPresent() {
    const sid = new URLSearchParams(window.location.search).get('shared_id');
    if (!sid) return;
    const shareUrl = `/shared/${encodeURIComponent(sid)}`;
    cwReceiveRoute({
      source: 'shared-id',
      name: `shared_${sid}.gpx`,
      importOn: 'arrival',
      fetchText: async () => {
        const text = await fetchText(shareUrl, { credentials: 'omit' });
        fetch(shareUrl, { method: 'DELETE' }).catch(() => {});
        return text;
      },
    });
  }

  // NOTE: localizeHeader moved to ui.js; gpx-share.js will call the global function if present.

  // Expose some helpers globally (non-enumerable)
  window.cwInjectGPXFromText = cwInjectGPXFromText;

  // Boot/initialization logic is exposed so the main app can control when to start.
  // Called while app.js loads, before the map exists: every entry below asks for its route
  // at once and waits for the map inside its request.
  function initGpxShare() {
    registerServiceWorker();
    sessionStorageHandoff();
    // prefer UI module's header localize if available
    try { if (typeof window.localizeHeader === 'function') window.localizeHeader(); } catch(_) {}
    // Whatever the service worker stored while no page was reading.
    takeSharedFromServiceWorker();

    // ?gpx_url= / ?url= — the documented way to open a hosted route.
    loadFromParams();

    // handle shared_id server copies
    loadSharedIdIfPresent();
  }

  // Expose initializer so the app can control boot timing
  window.initGpxShare = initGpxShare;

})();
