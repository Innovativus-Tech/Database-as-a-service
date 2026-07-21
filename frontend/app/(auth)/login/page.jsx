'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import Button from '@/components/ui/Button';
import GoogleButton from '@/components/ui/GoogleButton';
import Input from '@/components/ui/Input';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  // Google OAuth failures land back here as /login?error=...
  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) {
      toast.error(oauthError);
      router.replace('/login');
    }
  }, [searchParams, router]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.login(email, password, needsTotp ? totp : undefined);
      if (res.twoFactorRequired) {
        setNeedsTotp(true);
        return;
      }
      login(res);
      toast.success('Welcome back');
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          <span className="text-md font-semibold tracking-tight">CustomDB</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-text-secondary">Manage your self-hosted databases.</p>

        <div className="mt-8">
          <GoogleButton label="Sign in with Google" />
          <div className="mt-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-wider text-text-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {!needsTotp ? (
            <>
              <Input
                label="Email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Input
                label="Password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                error={error}
              />
              <div className="text-right">
                <Link href="/forgot-password" className="text-sm text-text-secondary underline-offset-4 hover:text-text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                Enter the 6-digit code from your authenticator app.
              </p>
              <Input
                label="Verification code"
                inputMode="numeric"
                autoFocus
                required
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="font-mono tracking-widest"
                error={error}
              />
            </>
          )}
          <Button type="submit" loading={busy} className="w-full" size="lg">
            {needsTotp ? 'Verify' : 'Sign in'}
          </Button>
          {needsTotp && (
            <button
              type="button"
              onClick={() => { setNeedsTotp(false); setTotp(''); setError(null); }}
              className="w-full text-center text-sm text-text-secondary hover:text-text-primary"
            >
              Back
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          No account?{' '}
          <Link href="/signup" className="text-text-primary underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-6 text-sm text-text-secondary">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
