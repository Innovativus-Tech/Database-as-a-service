'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getEmail, clearSession, setSession, api } from './api';

const AuthContext = createContext({
  user: null,
  email: null,
  loading: true,
  login: () => {},
  logout: () => {},
  setUser: () => {},
  refreshUser: () => {},
});

// Bootstrap a minimal "tentative" user object from localStorage so the UI
// doesn't show logged-out state for one frame on every page load. The real
// /me call will overwrite this with the full user shape (avatar, fullName,
// org, etc.) once it succeeds.
function tentativeUserFromStorage() {
  if (typeof window === 'undefined') return null;
  const email = getEmail();
  if (!email) return null;
  return { email, _tentative: true };
}

// Retry /me a few times with exponential backoff. Heavy customer migrations
// can push the backend into multi-second latencies; if we give up after the
// first failure, the user gets bounced to /login even though their session
// is fine. With backoff, we ride through transient slowness.
async function fetchMeWithRetry(maxAttempts = 4) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await api.me();
    } catch (err) {
      lastErr = err;
      // 401 means the session is genuinely invalid — no point retrying.
      if (err?.status === 401) throw err;
      // Other errors (timeouts, 5xx, network) are likely transient. Back off.
      const delayMs = Math.min(1000 * 2 ** attempt, 5000);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export function AuthProvider({ children }) {
  // Start with whatever localStorage says — better than null because
  // it prevents a logout flash on refresh while we re-verify.
  const [user, setUser] = useState(() => tentativeUserFromStorage());
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetchMeWithRetry();
      setUser(res.user);
      return res.user;
    } catch (err) {
      // ONLY clear auth state on a real 401. For any other error
      // (network, timeout, 5xx — e.g., backend is overloaded mid-migration),
      // keep the existing user state and let the user retry naturally.
      // This prevents the "you're suddenly logged out" bug when the backend
      // is temporarily slow.
      if (err?.status === 401) {
        clearSession();
        setUser(null);
      } else {
        console.warn('[auth] /me failed (keeping existing session):', err?.message || err);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(({ token, user: u }) => {
    setSession({ token, email: u.email });
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, email: user?.email ?? null, loading, login, logout, setUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useRequireAuth() {
  const { email, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    // Only redirect if we're done loading AND there's no token anywhere.
    // (email derives from user; user is null only after a real 401 now.)
    if (!loading && !email) router.replace('/login');
  }, [email, loading, router]);
  return { email, loading };
}
