'use client';

// Host route for the PivotDB console.
//
// An optional catch-all (`[[...slug]]`) so every path under /operate — and
// /operate itself — renders this one page. React Router then takes over
// client-side with basename="/operate", which keeps deep links, refreshes and
// browser history working exactly as they did in the standalone app.
//
// Rendering is deliberately client-only: the console talks to the API with a
// bearer token from localStorage and opens Socket.IO streams, none of which
// exist during SSR.

import dynamic from 'next/dynamic';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';

const OperateApp = dynamic(() => import('@/components/operate/App'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-text-muted">
      Loading console…
    </div>
  ),
});

export default function OperatePage() {
  // Same guard as every other dashboard page: one session, one redirect.
  const { email, loading } = useRequireAuth();
  if (loading || !email) return null;

  return (
    <AppShell>
      {/* `operate-console` scopes the console's blanket CSS rules (see
          globals.css) so they can't repaint the surrounding dashboard. */}
      <div className="operate-console">
        <OperateApp />
      </div>
    </AppShell>
  );
}
