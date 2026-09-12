/* Map tiles that survive losing coverage.
 *
 * The web view's own HTTP cache does not keep them: serving tiles from a real server,
 * loading a route, taking the server away and reopening produced nothing. So tiles are
 * kept here instead, in IndexedDB, as they are viewed.
 *
 * This caches what the user actually looked at. It never fetches ahead, which is the
 * line OpenStreetMap's tile policy draws: caching what you requested is fine, bulk
 * downloading is not.
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
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function writeTile(url, blob) {
    if (!blob || blob.size === 0 || blob.size > MAX_TILE_BYTES) return;
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      // Running out of storage surfaces on the transaction, not on the call, and an
      // unhandled one is noisy. Nothing to do about it beyond not caching this tile.
      tx.onerror = () => { console.warn('[cw] tile not cached:', tx.error && tx.error.name); };
      tx.objectStore(STORE).put({ url, blob, ts: Date.now() });
    } catch (_) { return; }
    // Trimming walks the whole store, so do it occasionally rather than every write.
    if (++writesSinceTrim >= 100) { writesSinceTrim = 0; trim(db); }
  }

  function trim(db) {
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const countReq = store.count();
      countReq.onsuccess = () => {
        let over = countReq.result - TRIM_TO;
        if (countReq.result <= MAX_TILES || over <= 0) return;
        // Oldest first, which for map tiles is a good enough approximation of
        // "least likely to be looked at again".
        const cursorReq = store.index('ts').openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor || over-- <= 0) return;
          cursor.delete();
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
      writeTile(url, blob);
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
