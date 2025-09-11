/* Minimal service worker to accept POSTed GPX bodies from Shortcuts and persist them in IndexedDB.
   Usage from Shortcuts: Make a POST to https://your-site/share (body = raw GPX, content-type text/xml/application/gpx+xml).
   The SW will store it and redirect the client to /index.html so the app can read it from IndexedDB.
*/
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => { ev.waitUntil(self.clients.claim()); });

const DB_NAME = 'cw_shared_db';
const STORE = 'files';

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = (e) => {
      try { e.target.result.createObjectStore(STORE); } catch(_) {}
    };
    r.onsuccess = (e) => resolve(e.target.result);
    r.onerror = (e) => reject(e);
  });
}
function idbPut(key, val) {
  return openDB().then(db => new Promise((res, rej) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => { try { db.close(); } catch(_) {} ; res(true); };
      tx.onerror = () => { try { db.close(); } catch(_) {} ; rej(tx.error); };
    } catch (err) { try { db.close(); } catch(_) {}; rej(err); }
  }));
}

self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url);
    const path = (url.pathname || '').toLowerCase();

    const shouldHandlePost = event.request.method === 'POST' && (
      path.endsWith('/share') ||
      path.endsWith('/share-gpx') ||
      path.endsWith('/share_receiver') ||
      url.searchParams.has('share') ||
      url.searchParams.has('final')
    );

    if (!shouldHandlePost) return; // do not intercept other requests

    event.respondWith((async () => {
      try {
        const text = await event.request.text();
        const name = url.searchParams.get('name') || event.request.headers.get('x-gpx-name') || 'shared.gpx';
        await idbPut('gpx', { text: String(text || ''), name: String(name || 'shared.gpx'), ts: Date.now() });

        // notify clients (if any) so they can react immediately
        const all = await self.clients.matchAll({ includeUncontrolled: true });
        for (const c of all) {
          try { c.postMessage({ type: 'cw-shared-gpx', name }); } catch (_) {}
        }

        // Redirect the caller to the app so it can load the stored GPX
        return Response.redirect('/index.html?shared=1', 303);
      } catch (err) {
        return new Response('Error storing GPX', { status: 500 });
      }
    })());
  } catch (e) {
    // If any error parsing URL etc., let the request through
    return;
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method === 'POST' && event.request.url.includes('/share')) {
    event.respondWith(handleSharePost(event.request));
    return;
  }
});

async function handleSharePost(request) {
  try {
    const text = await request.text();
    if (text && text.trim().length > 0) {
      // Store in IndexedDB
      const db = await openIndexedDB();
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      store.put({ text: text, name: 'shared.gpx', ts: Date.now() }, 'gpx');
      tx.oncomplete = () => db.close();
      // Redirect to index.html
      return Response.redirect('/index.html?shared=1', 303);
    } else {
      return new Response('No GPX content', { status: 400 });
    }
  } catch (e) {
    return new Response('Error processing GPX', { status: 500 });
  }
}

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cw_shared_db', 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('files');
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e);
  });
}
