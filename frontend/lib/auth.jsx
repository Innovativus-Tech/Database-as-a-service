'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getEmail, getToken, clearSession, setSession } from './api';

const AuthContext = createContext({
  email: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }) {
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) setEmail(getEmail());
    setLoading(false);
  }, []);

  const login = useCallback(({ token, user }) => {
    setSession({ token, email: user.email });
    setEmail(user.email);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setEmail(null);
  }, []);

  return (
    <AuthContext.Provider value={{ email, loading, login, logout }}>
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
