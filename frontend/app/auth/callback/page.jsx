'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, setSession, clearSession } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Lands here from the backend's Google OAuth callback with the session JWT in
// the URL fragment (#token=...). Fragments never leave the browser, so the
// token stays out of server logs. Store it, fetch the profile, go to the app.
export default function AuthCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    // Scrub the token from the address bar / history immediately.
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      router.replace('/login');
      return;
    }

    (async () => {
      try {
        setSession({ token });
        const res = await api.me();
        login({ token, user: res.user });
        toast.success('Signed in with Google');
        router.replace('/dashboard');
      } catch {
        clearSession();
        toast.error('Sign-in failed. Please try again.');
        router.replace('/login');
      }
    })();
  }, [login, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Signing you in…
      </div>
    </div>
  );
}
