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

    // Before the body is read, because reading it is most of what an abuser costs.
    if (await overRateLimit(request)) {
      return new Response('Too many requests', {
        status: 429,
        headers: { ...corsHeaders(), 'retry-after': String(RATE_WINDOW_SECONDS) }
      });
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

/*
 * Anyone can POST 2.5 MB here and it lands in KV. The TTL bounds how long a route is
 * kept, not how many are written, so the endpoint had no ceiling at all: a loop is
 * someone else's storage and request bill.
 *
 * The counter lives in the Cloudflare cache rather than in KV, so throttling costs no
 * KV writes of its own — paying for the counter per request would be its own small
 * version of the problem. Every request counts, not only the ones that store: reading
 * the body is the expensive part and a rejected request has already been read.
 *
 * ponytail: the cache is per data centre, so a flood spread across colos still gets
 * RATE_LIMIT per colo, and the count is read-then-write rather than atomic, so a burst
 * of simultaneous requests can overshoot by a few. It stops one client hammering one
 * endpoint, which is the case that actually happens. A real global ceiling is a
 * Cloudflare rate-limiting or WAF rule on /share, configured in the dashboard — see
 * AGENTS.md. This is the floor under that, not a replacement for it.
 */
const RATE_LIMIT = 12;
const RATE_WINDOW_SECONDS = 60;

async function overRateLimit(request) {
  const ip = request.headers.get('cf-connecting-ip');
  // No IP to key on: nothing to limit by, and guessing from a client-supplied header
  // would let one forged value throttle everyone. Cloudflare always sets this one, and
  // sets it itself — a client cannot spoof it.
  if (!ip || !globalThis.caches) return false;
  try {
    // A namespace of its own rather than the zone's fetch cache, and a key on this
    // origin. `caches.default` with an off-zone key such as `https://rate.invalid/…`
    // is not a documented pattern and may simply be rejected, which — with the catch
    // below — would leave the limiter looking implemented and doing nothing.
    const cache = globalThis.caches.open
      ? await globalThis.caches.open('ratelimit')
      : globalThis.caches.default;
    const key = new Request(new URL(`/__ratelimit/${encodeURIComponent(ip)}`, request.url).toString());
    const seen = await cache.match(key);
    const now = Date.now();
    // A fixed window with its own start time, not a counter whose expiry every request
    // pushes out. That earlier shape punished exactly the wrong people: one request
    // every 30 seconds from a shared address never comes close to twelve in a minute,
    // but each one refreshed the entry, the count climbed for ever, and everybody
    // behind that address was eventually locked out and kept out. Here the count
    // belongs to a window, and a request arriving after the window ends starts a new
    // one — so the limit means what it says, twelve in any sixty seconds.
    let { n = 0, t = now } = seen ? await seen.json().catch(() => ({})) : {};
    if (!Number.isFinite(n) || !Number.isFinite(t) || now - t >= RATE_WINDOW_SECONDS * 1000) {
      n = 0;
      t = now;
    }
    n += 1;
    await cache.put(key, new Response(JSON.stringify({ n, t }), {
      // Twice the window so the entry outlives its own start time; the timestamp is
      // what decides, and an entry evicted early only means a fresh window.
      headers: { 'cache-control': `max-age=${RATE_WINDOW_SECONDS * 2}` }
    }));
    return n > RATE_LIMIT;
  } catch (err) {
    // A share must not fail because the counter did — but this must never be silent.
    // A rate limiter that quietly stopped working looks exactly like one that works.
    console.error('share: rate counter unavailable, letting the request through', err);
    return false;
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
