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
    const redirectTo = `${url.origin}/?shared=1&shared_id=${encodeURIComponent(id)}`;
    return Response.redirect(redirectTo, 302);
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500 });
  }
}
