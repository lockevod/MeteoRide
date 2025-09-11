export async function onRequest(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/share') {
      return fetch(request);
    }

    const TTL_SECONDS = 120; // align with Node local server default (can adjust if needed)
    const raw = await request.text();
    if (!raw || raw.indexOf('<gpx') === -1) {
      return new Response('No GPX content received', { status: 400 });
    }

    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    await env.SHARED_GPX.put(id, raw, { expirationTtl: TTL_SECONDS });

    const sharedUrl = `/shared/${encodeURIComponent(id)}`; // one-time GPX fetch URL
    const indexUrl = `/index.html?shared_id=${encodeURIComponent(id)}`; // app entry with param

    // Follow redirect only if explicitly requested like Node implementation
    const follow = url.searchParams.get('follow') === '1' || request.headers.get('X-Follow-Redirect') === '1';

    if (follow) {
      return new Response(`Redirecting to ${sharedUrl} (open app: ${indexUrl})`, {
        status: 303,
        headers: {
          'Location': sharedUrl,
          'X-Shared-Index': indexUrl,
          'Cache-Control': 'no-store'
        }
      });
    }

    // Default JSON (safer for iOS Shortcuts / avoids auto-follow of 303)
    const payload = {
      id,
      sharedUrl,
      indexUrl,
      message: `Stored as ${id}.gpx`,
      expires_in: TTL_SECONDS
    };
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response('Function error: ' + String(err), { status: 500 });
  }
}
