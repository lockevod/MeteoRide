// Cloudflare Pages Function: GET /shared/:id (single-use) + HEAD existence check
export async function onRequest(context) {
  try {
    const { request, env, params } = context;
    const method = request.method;
  const url = new URL(request.url);
  // Allow configuring auto-delete behavior via environment variable SHARED_AUTO_DELETE
  // If SHARED_AUTO_DELETE is set to '1' or 'true' (case-insensitive), GET will schedule deletion.
  const AUTO_DELETE_ON_GET = (typeof env.SHARED_AUTO_DELETE !== 'undefined') ? (String(env.SHARED_AUTO_DELETE).toLowerCase() === '1' || String(env.SHARED_AUTO_DELETE).toLowerCase() === 'true') : false;
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

    // Allow DELETE for post-import cleanup and HEAD/GET
    if (method !== 'GET' && method !== 'DELETE') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    if (method === 'DELETE') {
      // Allow explicit delete for cleanup
      try{
        await env.SHARED_GPX.delete(id);
        return new Response('Deleted', { status: 200, headers: { ...corsHeaders(), 'X-Shared-Exists': '0' } });
      }catch(e){ return new Response('Delete failed', { status: 500, headers: corsHeaders() }); }
    }

    const data = await env.SHARED_GPX.get(id);
    if (!data) return new Response('Not found', { status: 404, headers: corsHeaders() });

    // Determine if this GET should delete the KV entry after serving.
    // Priority: query param ?once=1 forces deletion for this request.
    const forceOnce = url.searchParams.get('once') === '1';

    if (AUTO_DELETE_ON_GET || forceOnce) {
      try { context.waitUntil(env.SHARED_GPX.delete(id)); } catch(_) { /* ignore */ }
    }

    return new Response(data, {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/gpx+xml',
        'Cache-Control': 'no-store',
        'X-Shared-Exists': '1'
      }
    });
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,HEAD,OPTIONS,DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, X-Follow-Redirect, X-Bypass-Service-Worker, Authorization',
  'Access-Control-Expose-Headers': 'Location, X-Shared-Exists, X-Shared-Index',
  'Access-Control-Max-Age': '600'
  };
}
