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
    const formData = await request.formData();
    const file = formData.get('file');
    if (file && (file.type === 'application/gpx+xml' || file.name.endsWith('.gpx'))) {
      const text = await file.text();
      const base64 = btoa(unescape(encodeURIComponent(text)));
      const redirectUrl = `/?gpx_data=${encodeURIComponent(base64)}`;
      const html = `<!DOCTYPE html><html><head><title>Sharing GPX...</title></head><body><script>window.location.href='${redirectUrl}';</script></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    } else {
      return new Response('Invalid file', { status: 400 });
    }
  } catch (e) {
    return new Response('Error processing file', { status: 500 });
  }
}
