'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { email, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(email ? '/dashboard' : '/login');
  }, [email, loading, router]);

  return <p className="text-slate-500">Redirecting...</p>;
}
