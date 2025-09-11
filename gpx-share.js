// Centralized GPX sharing / handoff utilities
(function(){
  // Register service worker and listen for shared GPX messages
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/service-worker.js');
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

  // Facade: prefer cwLoadGPXFromString when available, otherwise postMessage fallback.
  function cwInjectGPXFromText(gpxText, routeName){
    try {
      const name = routeName || 'Shared route';
      if (typeof window.cwLoadGPXFromString === 'function') {
        window.cwLoadGPXFromString(String(gpxText || ''), name);
        return true;
      }
      window.postMessage({ type: 'cw-gpx', name, gpx: String(gpxText || '') }, '*');
      return true;
    } catch(e){
      console.error('[cw] cwInjectGPXFromText error', e);
      return false;
    }
  }

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

    // wait for loader to be available (if possible)
    let tries = 0;
    await new Promise((res) => {
      const t = setInterval(() => {
        tries++;
        const ok = typeof window.cwLoadGPXFromString === "function";
        if (ok || tries >= 60) { clearInterval(t); res(ok); }
      }, 250);
    });

    try {
      const txt = await fetchText(gpxUrl);
      if (!txt || !txt.includes("<gpx")) throw new Error("Fetched content is not GPX");
      window.cwLoadGPXFromString && window.cwLoadGPXFromString(txt, name);
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

  // Localize header title and ensure logo adapts to header height
  function localizeHeader() {
    try {
      const h = document.getElementById('appTitle');
      const img = h && h.querySelector('.app-logo');
      if (window.t && h) {
        for (const n of Array.from(h.childNodes)) {
          if (n.nodeType === Node.TEXT_NODE) n.remove();
        }
        const txt = document.createTextNode(window.t('title'));
        h.appendChild(txt);
      }
      if (img && window.t) img.alt = window.t('title');
    } catch (e){ console.warn('[cw] header localize failed', e); }
  }

  // Expose some helpers globally (non-enumerable)
  window.cwInjectGPXFromText = cwInjectGPXFromText;
  window.readSharedGPXFromIDB = readSharedGPXFromIDB;
  window.openIndexedDB = openIndexedDB;

  // Boot sequence
  (async function boot(){
    await registerServiceWorker();
    sessionStorageHandoff();
    localizeHeader();
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

    // handle shared_id server copies
    loadSharedIdIfPresent();
  })();

})();
