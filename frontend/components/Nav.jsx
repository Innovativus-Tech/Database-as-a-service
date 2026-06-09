'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Nav() {
  const { email, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push('/login');
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href={email ? '/dashboard' : '/'} className="font-semibold text-slate-900">
          CustomDB
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {email ? (
            <>
              <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">Dashboard</Link>
              <Link href="/databases/new" className="text-slate-600 hover:text-slate-900">New Database</Link>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">{email}</span>
              <button onClick={handleLogout} className="text-slate-600 hover:text-slate-900">Log out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-slate-600 hover:text-slate-900">Log in</Link>
              <Link href="/signup" className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
