export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/share') {
      // Let static asset fallback (no 405 to avoid extra noise)
      return fetch(request);
    }
    const text = await request.text();
    if (!text || text.indexOf('<gpx') === -1) {
      return new Response('Bad GPX payload', { status: 400 });
    }
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
    await env.SHARED_GPX.put(id, text, { expirationTtl: 120 });
    const accept = request.headers.get('accept') || '';
    const wantsJSON = url.searchParams.get('json') === '1' || accept.includes('application/json');
    const appUrl = `${url.origin}/?shared=1&shared_id=${encodeURIComponent(id)}`;
    if (wantsJSON) {
      const body = JSON.stringify({
        shared_id: id,
        app_url: appUrl,
        fetch_url: `${url.origin}/shared/${encodeURIComponent(id)}`,
        expires_in: 120
      });
      return new Response(body, {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      });
    }
    // Default: redirect (302). If you prefer forcing GET semantics you could switch to 303.
    return Response.redirect(appUrl, 302);
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500 });
  }
}
