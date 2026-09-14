// Centralized GPX sharing / handoff utilities
(function(){
  // Register service worker and listen for shared GPX messages
  async function registerServiceWorker() {
    // The native shell receives shared files through the MeteoRideShare plugin,
    // so the service worker handoff is neither available nor needed there.
    if (window.CW_NATIVE) return;
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/scripts/service-worker.js');
    } catch (err) {
      console.warn('[cw] sw register failed', err);
    }
    if (navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', (ev) => {
        try {
          if (ev.data && ev.data.type === 'cw-shared-gpx') {
            readSharedGPXFromIDB().then(payload => {
              if (payload && payload.text) {
                window.cwInjectGPXFromText(payload.text, payload.name || ev.data.name);
              }
            }).catch(()=>{});
          }
        } catch(_) {}
      });
    }
  }

  // The loader draws the track straight onto the Leaflet map, so both the loader and
  // the map must exist. Shared routes routinely arrive before the app has booted:
  // the service worker handoff, ?gpx_url= and the native shell all fire early.
  function appReady() {
    return !!window.map && typeof window.cwLoadGPXFromString === 'function';
  }

  function whenAppReady(cb) {
    if (appReady()) return cb();
    const deadline = Date.now() + 20000;
    const timer = setInterval(() => {
      if (appReady()) {
        clearInterval(timer);
        cb();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        console.warn('[cw] app not ready after 20s; loading the route anyway');
        cb();
      }
    }, 250);
  }

  // Single entry point for every handoff path: service worker, ?gpx_url=, shared_id
  // and the native share extension.
  function cwInjectGPXFromText(gpxText, routeName){
    let name = routeName || 'Shared route';
    let text = String(gpxText || '');
    whenAppReady(() => {
      try {
        // The native inboxes accept .kml too; the loader only reads GPX. Detect it by
        // content (the usual case) or by the file name, since a long comment ahead of
        // <kml> can push it past the content-sniff window.
        const looksLikeKml = /<kml[\s>]/i.test(text.slice(0, 4096)) || /\.kml$/i.test(name);
        if (looksLikeKml && typeof window.cwKmlToGpxText === 'function') {
          const converted = window.cwKmlToGpxText(text);
          // A malformed KML, or a real GPX misnamed .kml, converts into a
          // syntactically valid but track-less GPX wrapper: toGeoJSON.kml() always
          // returns a FeatureCollection, even with zero Placemarks. Only accept the
          // conversion when it actually carries a track/route/waypoint; otherwise
          // keep the original text and name, since the input was likely GPX already.
          if (converted && /<trkpt\b|<rtept\b|<wpt\b|<trk\b|<rte\b/i.test(converted)) {
            text = converted;
            // reloadFull() re-reads window.lastGPXFile by its extension on every
            // recompute; keeping the .kml name would run this already-converted GPX
            // text back through the KML converter and lose the track.
            name = /\.kml$/i.test(name) ? name.replace(/\.kml$/i, '.gpx') : `${name}.gpx`;
          } else if (/\.kml$/i.test(name)) {
            // The conversion carried no track: this text was never real KML, most
            // likely a GPX file shared under a .kml name. Keep the original text but
            // rename it too, or reloadFull() would keep treating it as KML on every
            // recompute and run this GPX text back through the KML converter.
            name = name.replace(/\.kml$/i, '.gpx');
          }
        }
        if (typeof window.cwLoadGPXFromString === 'function') {
          window.cwLoadGPXFromString(text, name);
        } else {
          window.postMessage({ type: 'cw-gpx', name, gpx: text }, '*');
        }
      } catch(e){
        console.error('[cw] cwInjectGPXFromText error', e);
      }
    });
    return true;
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

  // Read GPX stored by the Service Worker in IndexedDB (one-time read)
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
          const gt = store.get('gpx');
          gt.onsuccess = () => {
            const val = gt.result || null;
            if (val) {
              // remove stored item so it's one-time
              store.delete('gpx');
            }
            tx.oncomplete = () => { try { db.close(); } catch(_) {} ; resolve(val); };
          };
          gt.onerror = () => { try { db.close(); } catch(_) {} ; resolve(null); };
        } catch (err) { resolve(null); }
      };
      req.onerror = () => resolve(null);
    });
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
        window.cwInjectGPXFromText(pending, routeName);
        console.log('[cw] loaded GPX from sessionStorage');
        if (window.openDebug) window.openDebug();
      }
    } catch(e){ console.warn('[cw] sessionStorage unavailable', e); }
  }

  // Helper to open the shared DB (used elsewhere)
  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('cw_shared_db', 1);
      request.onupgradeneeded = (e) => {
        try { e.target.result.createObjectStore('files'); } catch(_) {}
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  }

  // Called from UI when needing to load shared GPX (from '?shared' or message)
  async function loadSharedGPX() {
    try {
      const db = await openIndexedDB();
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const request = store.get('gpx');
      request.onsuccess = () => {
        const data = request.result;
        if (data && data.text) {
          // Parse and load the GPX
          if (typeof window.cw !== 'undefined' && window.cw.loadGPXFromText) {
            window.cw.loadGPXFromText(data.text, data.name || 'shared.gpx');
          } else {
            // fallback to injector
            window.cwInjectGPXFromText(data.text, data.name || 'shared.gpx');
          }
          // Clear the shared data
          const delTx = db.transaction('files', 'readwrite');
          delTx.objectStore('files').delete('gpx');
        }
      };
      request.onerror = () => console.error('Failed to load shared GPX');
    } catch (e) {
      console.error('Error loading shared GPX:', e);
    }
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

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  async function loadFromParams() {
    const { gpxUrl, name } = getParams();
    if (!gpxUrl) return;
    try {
      const txt = await fetchText(gpxUrl);
      if (!txt || !txt.includes("<gpx")) throw new Error("Fetched content is not GPX");
      cwInjectGPXFromText(txt, name);
    } catch (e) {
      console.warn('[ingest] loadFromParams error', e);
    }
  }

  // Auto-load GPX from server share_id parameter
  async function loadSharedIdIfPresent() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const sid = urlParams.get('shared_id');
      if (!sid) return;
      const shareUrl = `/shared/${encodeURIComponent(sid)}`;
      const resp = await fetch(shareUrl, { credentials: 'omit' });
      if (!resp.ok) return;
      const gpxText = await resp.text();
      if (gpxText && gpxText.length > 0) {
        window.cwInjectGPXFromText(gpxText, `shared_${sid}.gpx`);
        // Try to delete server copy to minimize retention
        try { await fetch(shareUrl, { method: 'DELETE' }); } catch (_) {}
      }
    } catch (e) { console.warn('shared_id load failed', e); }
  }

  // NOTE: localizeHeader moved to ui.js; gpx-share.js will call the global function if present.

  // Expose some helpers globally (non-enumerable)
  window.cwInjectGPXFromText = cwInjectGPXFromText;
  window.readSharedGPXFromIDB = readSharedGPXFromIDB;
  window.openIndexedDB = openIndexedDB;

  // Boot/initialization logic is exposed so the main app can control when to start
  async function initGpxShare() {
    await registerServiceWorker();
    sessionStorageHandoff();
    // prefer UI module's header localize if available
    try { if (typeof window.localizeHeader === 'function') window.localizeHeader(); } catch(_) {}
    // Try to read any GPX the SW might have stored
    try {
      const payload = await readSharedGPXFromIDB();
      if (payload && payload.text) {
        console.log('[cw] loaded GPX from IndexedDB (service-worker handoff)', payload.name || '');
        cwInjectGPXFromText(payload.text, payload.name || 'Shared route');
      }
    } catch (e) { console.warn('[cw] readSharedGPXFromIDB error', e); }

    // Listen for in-page messages to load shared GPX
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'cw-shared-gpx') {
          loadSharedGPX();
        }
      });
    }

    // If URL has ?shared, attempt to load
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('shared')) loadSharedGPX();
    } catch (_) {}

    // ?gpx_url= / ?url= — the documented way to open a hosted route.
    loadFromParams();

    // handle shared_id server copies
    loadSharedIdIfPresent();
  }

  // Expose initializer so the app can control boot timing
  window.initGpxShare = initGpxShare;

})();
