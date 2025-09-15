// Cloudflare Pages Function: POST /share
// Adds CORS + preflight + TTL single-use style storage in KV (namespace SHARED_GPX)
export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'POST' || url.pathname !== '/share') {
      // Pass through for other assets / methods
      return fetch(request);
    }

  // Keep shared GPX in KV for a configurable period (env.SHARED_TTL_SECONDS) default 2 minutes
  const ttlEnv = env.SHARED_TTL_SECONDS || env.SHARED_TTL || ''; 
  const parsed = parseInt(String(ttlEnv || '' ).trim(), 10);
  const TTL_SECONDS = (Number.isFinite(parsed) && parsed > 0) ? parsed : 120; // default 120s
    const contentType = request.headers.get('content-type') || '';
    let raw;
    if (/multipart\/form-data/i.test(contentType)) {
      // Accept first file part (field name 'file' preferred) or any File
      try {
        const form = await request.formData();
        let file = form.get('file');
        if (!file) {
          for (const [k, v] of form.entries()) {
            if (v instanceof File) { file = v; break; }
          }
        }
        if (file && file.text) raw = await file.text();
      } catch (e) {
        return new Response('Multipart parse error', { status: 400, headers: corsHeaders() });
      }
    } else {
      raw = await request.text();
    }

    if (!raw || raw.indexOf('<gpx') === -1) {
      return new Response('No GPX content received', { status: 400, headers: corsHeaders() });
    }

    if (raw.length > 2_500_000) {
      return new Response('GPX too large', { status: 413, headers: corsHeaders() });
    }

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    // Attempt to write and verify the KV entry to avoid races/failed writes
    try{
      await env.SHARED_GPX.put(id, raw, { expirationTtl: TTL_SECONDS });
    } catch(err){
      return new Response('KV write failed: '+String(err), { status: 500, headers: corsHeaders() });
    }
    // Verify write by reading back once
    try{
      const check = await env.SHARED_GPX.get(id);
      if(!check){
        return new Response('KV write not visible after put', { status: 500, headers: corsHeaders() });
      }
    } catch(err){
      return new Response('KV verify failed: '+String(err), { status: 500, headers: corsHeaders() });
    }

    // If caller provided a filename, sanitize and include it in the shared URL
    let fileName = request.headers.get('X-File-Name') || '';
    fileName = String(fileName || '').trim();
    if(fileName){
      // sanitize: keep alphanum, dash, underscore and dot
      fileName = fileName.replace(/[^A-Za-z0-9._-]+/g, '_');
      // ensure extension .gpx
      if(!/\.gpx$/i.test(fileName)) fileName = fileName + '.gpx';
    }

  const sharedUrl = fileName ? `/shared/${encodeURIComponent(id)}_${encodeURIComponent(fileName)}` : `/shared/${encodeURIComponent(id)}.gpx`;
  const indexUrl = `/index.html?shared_id=${encodeURIComponent(id)}`;
  const absoluteShared = url.origin.replace(/\/$/, '') + sharedUrl;
  const absoluteIndex = url.origin.replace(/\/$/, '') + indexUrl;

    const follow = url.searchParams.get('follow') === '1' || request.headers.get('X-Follow-Redirect') === '1';

    if (follow) {
      return new Response(`Redirecting to ${absoluteShared} (open app: ${absoluteIndex})`, {
        status: 303,
        headers: {
          ...corsHeaders(),
          'Location': absoluteShared,
          'X-Shared-Index': absoluteIndex,
          'X-Shared-Exists': '1',
          'Cache-Control': 'no-store'
        }
      });
    }

    const payload = {
      id,
      sharedUrl,
      indexUrl,
      url: absoluteShared,
      message: fileName ? `Stored as ${id}_${fileName}` : `Stored as ${id}.gpx`,
      expires_in: TTL_SECONDS
    };
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Location': absoluteShared,
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
  'Access-Control-Allow-Methods': 'GET,POST,HEAD,OPTIONS',
  // Allow common custom headers used by the client/userscript
  'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, X-Follow-Redirect, X-Bypass-Service-Worker, Authorization',
  // Expose useful response headers to the browser (Location and our X- headers)
  'Access-Control-Expose-Headers': 'Location, X-Shared-Exists, X-Shared-Index',
  'Access-Control-Max-Age': '600'
  };
}
