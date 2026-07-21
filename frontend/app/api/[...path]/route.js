export const dynamic = 'force-dynamic';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://backend:4000';

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
  };

  if (hasBody) {
    init.body = Buffer.from(await req.arrayBuffer());
  }

  const upstream = await fetch(targetUrl(req, params.path), init);
  const headers = new Headers(upstream.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
