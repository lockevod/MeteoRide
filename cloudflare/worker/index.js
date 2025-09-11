// Cloudflare Worker: temporary GPX share endpoint
// - POST /share  : accepts raw GPX body, stores in KV (SHARED_GPX) with TTL (120s), returns 302 redirect to /?shared=1&shared_id=<id>
// - GET  /shared/<id> : returns GPX stored in KV and deletes it (one-time read)
// Notes:
//  * Bind a KV namespace in Cloudflare named SHARED_GPX (or adjust binding name below)
//  * This file is intended to be deployed as a Worker behind the same origin that serves the app

addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  const url = new URL(request.url);
  try {
    if (request.method === 'POST' && url.pathname === '/share') {
      const text = await request.text();
      if (!text || text.indexOf('<gpx') === -1) {
        return new Response('Bad GPX payload', { status: 400 });
      }
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
      // SHARED_GPX is the KV binding name (configure in Cloudflare dashboard)
      await SHARED_GPX.put(id, text, { expirationTtl: 120 }); // expires in 120 seconds
      const redirectTo = `${url.origin}/?shared=1&shared_id=${encodeURIComponent(id)}`;
      return Response.redirect(redirectTo, 302);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/shared/')) {
      const parts = url.pathname.split('/');
      const id = parts[parts.length - 1];
      if (!id) return new Response('Not found', { status: 404 });
      const data = await SHARED_GPX.get(id);
      if (!data) return new Response('Not found', { status: 404 });
      // Optionally delete immediately for one-time read
      try { await SHARED_GPX.delete(id); } catch (_) {}
      return new Response(data, { status: 200, headers: { 'Content-Type': 'application/gpx+xml' } });
    }

    // Fallback: if not our route, pass-through (optional)
    return fetch(request);
  } catch (err) {
    return new Response('Worker error: ' + String(err), { status: 500 });
  }
}

// End of worker
