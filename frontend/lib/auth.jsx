'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, clearSession, setSession, api } from './api';

const AuthContext = createContext({
  user: null,
  email: null,
  loading: true,
  login: () => {},
  logout: () => {},
  setUser: () => {},
  refreshUser: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.me();
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
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
    if (!loading && !email) router.replace('/login');
  }, [email, loading, router]);
  return { email, loading };
}
