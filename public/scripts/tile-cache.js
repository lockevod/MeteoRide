/* Map tiles that survive losing coverage.
 *
 * The web view's own HTTP cache does not keep them: serving tiles from a real server,
 * loading a route, taking the server away and reopening produced nothing. So tiles are
 * kept here instead, in IndexedDB, as they are viewed.
 *
 * This caches what the user actually looked at, and only for as long as the tile server
 * says. OpenStreetMap's tile policy allows re-visits from a local cache that honours the
 * server's caching headers (or keeps a tile at least 7 days when they cannot be read),
 * and forbids bulk downloading and offline use beyond that. So nothing is fetched ahead,
 * every tile carries the expiry its response gave it, and an expired tile is never
 * served, with or without a connection. A blank map out of coverage is then correct.
 *
 * Reading a tile's bytes needs a cross-origin fetch, and if the tile server does not
 * allow one this falls back to a plain <img>, which is exactly how the map worked
 * before. That fallback is remembered so the attempt is not repeated for every tile.
 */
(function () {
  const DB_NAME = 'cw_tiles';
  const STORE = 'tiles';
  const MAX_TILES = 1200;      // roughly 25-30 MB of PNG
  const TRIM_TO = 1000;        // how far down to go once over the cap
  const MAX_TILE_BYTES = 512 * 1024;
  const NO_CORS_KEY = 'cw_tiles_no_cors';
  const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;   // the policy's floor when headers are missing
  const SWEPT_KEY = 'cw_tiles_swept';
  const SWEEP_EVERY_MS = 24 * 3600 * 1000;

  /** When a response stops being fresh, from its own headers; null = do not keep it.
   *  Cache-Control and Expires are CORS-safelisted, so a cross-origin read sees them. */
  function expiryOf(res, now) {
    const cc = (res.headers.get('Cache-Control') || '').toLowerCase();
    // no-cache means "revalidate before every use", which a tile shown offline cannot be.
    if (/\bno-store\b|\bno-cache\b/.test(cc)) return null;
    // ponytail: max-age counts from receipt, because Age (how long a CDN or the web
    // view's HTTP cache already held the response) is not CORS-readable and OSM does not
    // expose it. A tile can so outlive its freshness by up to that age. This cache is
    // only read when the network fails, and OSM sends stale-if-error=604800, which lets
    // a stale tile be used on error for 7 more days; if a server ever sends max-age with
    // no stale-if-error, expose Age there or halve max-age here.
    const maxAge = cc.match(/(?:^|[,\s])max-age\s*=\s*(\d+)/);
    if (maxAge) return Number(maxAge[1]) > 0 ? now + Number(maxAge[1]) * 1000 : null;
    const expiresHeader = res.headers.get('Expires');
    if (expiresHeader !== null) {
      // An Expires that does not parse means "already expired" (RFC 9111 §5.3).
      const expires = Date.parse(expiresHeader);
      return !Number.isNaN(expires) && expires > now ? expires : null;
    }
    return now + DEFAULT_TTL_MS;
  }
  // A record written before expiries were stored: treated as kept for the default.
  const expiryOfRecord = (r) => (typeof r.exp === 'number' ? r.exp : (r.ts || 0) + DEFAULT_TTL_MS);

  let dbPromise = null;
  let writesSinceTrim = 0;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let request;
      try { request = indexedDB.open(DB_NAME, 1); }
      catch (e) { return reject(e); }
      request.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'url' }).createIndex('ts', 'ts');
        }
      };
      request.onsuccess = (ev) => {
        const db = ev.target.result;
        // Trim on open, not only on the write counter: a session that views fewer
        // tiles than the counter's threshold would never trim at all, and the store
        // would grow without bound across sessions.
        trim(db);
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((e) => {
      console.warn('[cw] tile cache unavailable', e);
      return null;
    });
    return dbPromise;
  }

  async function readTile(url) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(url);
        req.onsuccess = () => {
          const r = req.result && expiryOfRecord(req.result) > Date.now() ? req.result : null;
          // A record from an older Android/web build still has `blob` directly; a new
          // one has the raw bytes, rebuilt into a Blob here (cheap, and creating one in
          // memory works fine on WebKit — only storing one in IndexedDB does not).
          resolve(r ? (r.blob || (r.bytes ? new Blob([r.bytes], { type: r.type }) : null)) : null);
        };
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function writeTile(url, blob, exp) {
    if (!exp || !blob || blob.size === 0 || blob.size > MAX_TILE_BYTES) return;
    const db = await openDb();
    if (!db) return;
    try {
      // Stored as bytes, not a Blob: WebKit's IndexedDB throws UnknownError on a Blob
      // put (Chromium accepts it), so iOS cached no tile at all.
      const bytes = await blob.arrayBuffer();
      const tx = db.transaction(STORE, 'readwrite');
      // Running out of storage surfaces on the transaction, not on the call, and an
      // unhandled one is noisy. Nothing to do about it beyond not caching this tile.
      tx.onerror = () => { console.warn('[cw] tile not cached:', tx.error && tx.error.name); };
      tx.objectStore(STORE).put({ url, bytes, type: blob.type, ts: Date.now(), exp });
    } catch (_) { return; }
    // Trimming walks the whole store, so do it occasionally rather than every write.
    if (++writesSinceTrim >= 100) { writesSinceTrim = 0; trim(db); }
  }

  function trim(db) {
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const countReq = store.count();
      countReq.onsuccess = () => {
        // Over the cap, down to TRIM_TO; under it, nothing to drop but expired tiles.
        let over = countReq.result > MAX_TILES ? countReq.result - TRIM_TO : 0;
        const now = Date.now();
        // The sweep for expired tiles walks every record, bytes and all, and holds up the
        // first tile reads of a cold start; readTile refuses expired tiles by itself, so
        // the sweep only frees space and once a day is plenty.
        let swept = 0;
        try { swept = Number(localStorage.getItem(SWEPT_KEY)) || 0; } catch (_) {}
        const sweep = now - swept > SWEEP_EVERY_MS;
        if (!over && !sweep) return;
        if (sweep) { try { localStorage.setItem(SWEPT_KEY, String(now)); } catch (_) {} }
        // Oldest first, which for map tiles is a good enough approximation of
        // "least likely to be looked at again". Expired tiles go wherever they are.
        const cursorReq = store.index('ts').openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor || (over <= 0 && !sweep)) return;
          if (over > 0) { over--; cursor.delete(); }
          else if (expiryOfRecord(cursor.value) <= now) cursor.delete();
          cursor.continue();
        };
      };
    } catch (e) { console.warn('[cw] tile cache trim failed', e); }
  }

  const corsKnownBad = () => {
    try { return localStorage.getItem(NO_CORS_KEY) === '1'; } catch (_) { return false; }
  };
  const rememberNoCors = () => {
    try { localStorage.setItem(NO_CORS_KEY, '1'); } catch (_) {}
  };

  function showBlob(tile, blob, done) {
    const objectUrl = URL.createObjectURL(blob);
    // Revoked when Leaflet drops the tile, not on load: revoking early can blank the
    // image when the element is moved around the DOM.
    tile._cwObjectUrl = objectUrl;
    tile.onload = () => done(null, tile);
    tile.onerror = (err) => done(err, tile);
    tile.src = objectUrl;
  }

  /** Plain <img>, the way the map worked before this file existed.
   *  onFailed may take over by returning true, in which case done() is left to it. */
  function showDirect(tile, url, done, onLoaded, onFailed) {
    tile.onload = () => { if (onLoaded) onLoaded(); done(null, tile); };
    tile.onerror = async (err) => {
      if (onFailed && (await onFailed())) return;
      done(err, tile);
    };
    tile.src = url;
  }

  async function loadTile(tile, url, done) {
    // No connection: the cache is the only chance, and a miss leaves the tile blank.
    if (navigator.onLine === false) {
      const cached = await readTile(url);
      return cached ? showBlob(tile, cached, done) : showDirect(tile, url, done);
    }

    // The tile server refuses cross-origin reads, so nothing new can be stored. A
    // tile stored earlier still rescues a request that fails now.
    if (corsKnownBad()) {
      return showDirect(tile, url, done, null, () => useCached(tile, url, done));
    }

    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      writeTile(url, blob, expiryOf(res, Date.now()));
      return showBlob(tile, blob, done);
    } catch (e) {
      if (await useCached(tile, url, done)) return;
      // The fetch failed. Only if the plain <img> then loads is the network fine and
      // the server simply refusing cross-origin reads; a request that fails both ways
      // is just a network problem and must not disable caching for good.
      return showDirect(tile, url, done, rememberNoCors);
    }
  }

  async function useCached(tile, url, done) {
    const cached = await readTile(url);
    if (!cached) return false;
    showBlob(tile, cached, done);
    return true;
  }

  /** A tile layer that keeps what it shows. Returns null when Leaflet is not loaded. */
  window.cwCreateTileLayer = function (urlTemplate, options) {
    if (!window.L || !window.L.TileLayer) return null;

    const CachingTileLayer = window.L.TileLayer.extend({
      createTile: function (coords, done) {
        const tile = document.createElement('img');
        tile.setAttribute('role', 'presentation');
        tile.alt = '';
        loadTile(tile, this.getTileUrl(coords), done);
        return tile;
      },
    });

    const layer = new CachingTileLayer(urlTemplate, options);
    layer.on('tileunload', (ev) => {
      const url = ev.tile && ev.tile._cwObjectUrl;
      if (url) { URL.revokeObjectURL(url); ev.tile._cwObjectUrl = null; }
    });
    return layer;
  };

  /** Drops every stored tile. Useful from the console, and if a settings screen
   *  ever wants a "free up space" button. */
  window.cwClearTileCache = async function () {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  };

  window.cwTileCacheStats = async function () {
    const db = await openDb();
    if (!db) return { tiles: 0 };
    return new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
      req.onsuccess = () => resolve({ tiles: req.result });
      req.onerror = () => resolve({ tiles: 0 });
    });
  };
})();
