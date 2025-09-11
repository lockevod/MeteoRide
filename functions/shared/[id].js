export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    const id = params.id;
    if (!id) return new Response('Not found', { status: 404 });
    const data = await env.SHARED_GPX.get(id);
    if (!data) return new Response('Not found', { status: 404 });
    try { await env.SHARED_GPX.delete(id); } catch (_) {}
    return new Response(data, { status: 200, headers: { 'Content-Type': 'application/gpx+xml' } });
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500 });
  }
}
