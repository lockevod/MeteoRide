export async function onRequest(context) {
  try {
    const request = context.request;
    const env = context.env;
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/share') {
      const text = await request.text();
      if (!text || text.indexOf('<gpx') === -1) {
        return new Response('Bad GPX payload', { status: 400 });
      }
      const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
      await env.SHARED_GPX.put(id, text, { expirationTtl: 120 });
      const redirectTo = `${url.origin}/?shared=1&shared_id=${encodeURIComponent(id)}`;
      return Response.redirect(redirectTo, 302);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/shared/')) {
      const parts = url.pathname.split('/');
      const id = parts[parts.length - 1];
      if (!id) return new Response('Not found', { status: 404 });
      const data = await env.SHARED_GPX.get(id);
      if (!data) return new Response('Not found', { status: 404 });
      try { await env.SHARED_GPX.delete(id); } catch (_) {}
      return new Response(data, { status: 200, headers: { 'Content-Type': 'application/gpx+xml' } });
    }

    // Fallback to static assets if any (Pages will handle)
    return fetch(request);
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500 });
  }
}
