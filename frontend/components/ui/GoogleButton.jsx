'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

// "Continue with Google" — a plain navigation to the backend's OAuth entry
// point (the Next /api proxy forwards it). No fetch: the whole flow is
// redirect-based, and the /auth/callback page completes the session.
export default function GoogleButton({ label = 'Continue with Google' }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        window.location.href = '/api/auth/google';
      }}
      className="inline-flex h-12 w-full items-center justify-center gap-3 rounded border border-border-strong bg-transparent text-md text-text-primary transition-colors duration-150 hover:bg-bg-inset hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
          <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.28 14.28A7.21 7.21 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11z" />
          <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z" />
        </svg>
      )}
      {label}
    </button>
  );
}
