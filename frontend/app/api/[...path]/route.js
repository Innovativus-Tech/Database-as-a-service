export const dynamic = 'force-dynamic';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://backend:4000';

// Absolute backstop so a wedged upstream connection can't be held open
// forever. Generous enough for large (up to 200 MB) import uploads on slow
// links; the point is only to kill genuinely-stuck sockets, not slow ones.
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS) || 10 * 60 * 1000;

function targetUrl(req, path) {
  const url = new URL(req.url);
  const target = new URL(`/api/${path.join('/')}${url.search}`, INTERNAL_API_URL);
  return target.toString();
}

function proxyHeaders(req) {
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('accept-encoding');
  return headers;
}

async function proxy(req, { params }) {
  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);

  // Bind the upstream request's lifetime to the client's. If the browser
  // disconnects (or we hit the backstop timeout), abort the backend fetch so
  // hung or abandoned requests can't accumulate and wedge the Next server.
  const controller = new AbortController();
  const onClientAbort = () => controller.abort();
  req.signal?.addEventListener('abort', onClientAbort);
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  const init = {
    method,
    headers: proxyHeaders(req),
    cache: 'no-store',
    // Without this, fetch() follows 3xx responses itself (default
    // redirect: 'follow') and returns the FINAL destination's body under
    // our own URL — e.g. the Google OAuth redirect from /api/auth/google
    // silently fetches accounts.google.com server-side and serves its HTML
    // back under dbaas.innovativus.tech/api/auth/google, breaking every
    // relative asset on that page. 'manual' passes the 3xx + Location
    // header straight through so the browser does the actual navigation.
    redirect: 'manual',
    signal: controller.signal,
  };

  if (hasBody && req.body) {
    // Stream the request body straight through instead of buffering it with
    // Buffer.from(await req.arrayBuffer()). Buffering loaded the ENTIRE upload
    // into the Next server's heap — a 200 MB import (the multer limit) spiked
    // frontend memory by ~200 MB per concurrent upload, and under host memory
    // pressure that got the frontend OOM-killed → it restarted with a new
    // container IP → Traefik's route pointed at the dead one → the site 504'd
    // while the new container's internal healthcheck still passed. Streaming
    // keeps memory flat regardless of upload size. duplex:'half' is required
    // by undici whenever the request body is a stream.
    init.body = req.body;
    init.duplex = 'half';
  }

  try {
    const upstream = await fetch(targetUrl(req, params.path), init);
    const headers = new Headers(upstream.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (err) {
    // Client disconnects and the backstop timeout both surface as AbortError.
    // Return a clean gateway status instead of letting it become an unhandled
    // rejection (which in some runtimes can crash the request handler).
    const aborted = err?.name === 'AbortError';
    return new Response(
      JSON.stringify({ error: aborted ? 'Upstream request timed out' : 'Upstream request failed' }),
      { status: aborted ? 504 : 502, headers: { 'content-type': 'application/json' } }
    );
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onClientAbort);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
