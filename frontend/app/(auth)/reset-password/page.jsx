'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!token) { setError('Reset link is missing a token'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setBusy(true);
    try {
      await api.resetPassword({ token, password });
      toast.success('Password updated');
      router.push('/login');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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

        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-text-secondary">Use at least 8 characters.</p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Input
            label="New password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
          <Input
            label="Confirm password"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            error={error}
          />
          <Button type="submit" loading={busy} className="w-full" size="lg" disabled={!token}>
            Update password
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Back to{' '}
          <Link href="/login" className="text-text-primary underline-offset-4 hover:underline">
            sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-6 text-sm text-text-secondary">Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
