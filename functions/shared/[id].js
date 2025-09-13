// Cloudflare Pages Function: GET /shared/:id (single-use) + HEAD existence check
export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    const method = request.method;
  let id = params.id;
  if (!id) return new Response('Not found', { status: 404, headers: corsHeaders() });
  // Accept id.gpx style paths; strip .gpx suffix if present
  if(id.toLowerCase().endsWith('.gpx')) id = id.slice(0, -4);
  // Support /shared/{id}_{filename}.gpx : extract id before first '_'
  const mId = id.match(/^([A-Za-z0-9\-]+)(?:_(.*))?$/);
  if(mId && mId[1]) id = mId[1];

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (method === 'HEAD') {
      const exists = await env.SHARED_GPX.get(id);
      return new Response(null, { status: exists ? 200 : 404, headers: { ...corsHeaders(), 'X-Shared-Exists': exists ? '1' : '0' } });
    }

    if (method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    const data = await env.SHARED_GPX.get(id);
    if (!data) return new Response('Not found', { status: 404, headers: corsHeaders() });

    // Delete single-use (do not block response)
    try { context.waitUntil(env.SHARED_GPX.delete(id)); } catch (_) { /* ignore */ }

    return new Response(data, {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/gpx+xml',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600'
  };
}
