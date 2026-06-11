// Lightweight liveness endpoint for Coolify-Traefik. Returns 200 immediately
// with no client rendering, no auth, no DB call. Used to keep the Traefik
// route active on the frontend service.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ service: 'customdb-frontend', status: 'ok' });
}
