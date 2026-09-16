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
    // The limit is on bytes and is enforced while reading, not after: Content-Length is
    // optional (a chunked upload carries none), and a string's length counts UTF-16
    // units, so multibyte text used to slip past a check made on the parsed result.
    // A multipart body is allowed a small envelope on top; the file inside is then held
    // to the limit itself.
    const MAX_BYTES = 2_500_000;
    const ENVELOPE_BYTES = 64_000;
    const tooLarge = () => new Response('GPX too large', { status: 413, headers: corsHeaders() });
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BYTES + ENVELOPE_BYTES) return tooLarge();
    const body = await readCapped(request, MAX_BYTES + ENVELOPE_BYTES);
    if (!body) return tooLarge();

    const contentType = request.headers.get('content-type') || '';
    // Blob.text() turns each invalid byte into U+FFFD, three bytes, so what is stored
    // could be three times what was counted. Refuse anything that is not UTF-8.
    const notUtf8 = () => new Response('Invalid UTF-8', { status: 400, headers: corsHeaders() });
    const decode = async (blob) => {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()); }
      catch (e) { if (e instanceof TypeError) return null; throw e; }
    };
    let raw;
    if (/multipart\/form-data/i.test(contentType)) {
      // Accept first file part (field name 'file' preferred) or any File
      let file;
      try {
        const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
        file = form.get('file');
        if (!file) {
          for (const [k, v] of form.entries()) {
            if (v instanceof File) { file = v; break; }
          }
        }
      } catch (e) {
        return new Response('Multipart parse error', { status: 400, headers: corsHeaders() });
      }
      if (file && file.size > MAX_BYTES) return tooLarge();
      if (file && file.arrayBuffer) {
        raw = await decode(file);
        if (raw === null) return notUtf8();
      }
    } else {
      if (body.size > MAX_BYTES) return tooLarge();
      raw = await decode(body);
      if (raw === null) return notUtf8();
    }

    if (!raw || raw.indexOf('<gpx') === -1) {
      return new Response('No GPX content received', { status: 400, headers: corsHeaders() });
    }

    // The id is the only thing standing between a stranger and someone's route (or its
    // deletion), so it has to be unguessable: 122 random bits, not a timestamp plus
    // six characters of Math.random().
    const id = crypto.randomUUID();
    // Attempt to write and verify the KV entry to avoid races/failed writes
    try{
      await env.SHARED_GPX.put(id, raw, { expirationTtl: TTL_SECONDS });
    } catch(err){
      console.error('share: KV write failed', err);
      return new Response('Storage error', { status: 500, headers: corsHeaders() });
    }
    // Verify write by reading back once
    try{
      const check = await env.SHARED_GPX.get(id);
      if(!check){
        console.error('share: KV write not visible after put', id);
        return new Response('Storage error', { status: 500, headers: corsHeaders() });
      }
    } catch(err){
      console.error('share: KV verify failed', err);
      return new Response('Storage error', { status: 500, headers: corsHeaders() });
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
    console.error('share failed', err);
    return new Response('Function error', { status: 500, headers: corsHeaders() });
  }
}

/** The request body as a Blob, or null as soon as it passes `limit` bytes. */
async function readCapped(request, limit) {
  if (!request.body) return new Blob([]);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks);
    size += value.byteLength;
    if (size > limit) {
      // Not awaited: a source that fails to cancel must not turn a 413 into a 500.
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
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
