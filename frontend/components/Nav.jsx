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
    <header className="border-b border-border bg-bg-sidebar">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href={email ? '/dashboard' : '/'} className="font-semibold text-text-primary">
          CustomDB
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {email ? (
            <>
              <Link href="/dashboard" className="text-text-secondary hover:text-text-primary">Dashboard</Link>
              <Link href="/databases/new" className="text-text-secondary hover:text-text-primary">New Database</Link>
              <span className="text-text-muted">|</span>
              <span className="text-text-secondary">{email}</span>
              <button onClick={handleLogout} className="text-text-secondary hover:text-text-primary">Log out</button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-text-secondary hover:text-text-primary">Log in</Link>
              <Link href="/signup" className="rounded-md bg-accent px-3 py-1.5 text-white hover:bg-accent-hover">Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
