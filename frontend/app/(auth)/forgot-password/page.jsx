'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email);
      setSent(true);
      toast.success('Reset link sent');
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

        <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Enter your account email and we will send a reset link.
        </p>

        {sent ? (
          <div className="mt-8 space-y-5">
            <div className="flex items-start gap-3 rounded border border-border-strong bg-bg-inset p-4">
              <MailCheck className="mt-0.5 h-5 w-5 text-accent" />
              <p className="text-sm text-text-secondary">
                If an account exists for that email, a password reset link is on its way.
              </p>
            </div>
            <Link href="/login">
              <Button type="button" className="w-full" size="lg">Back to sign in</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              error={error}
            />
            <Button type="submit" loading={busy} className="w-full" size="lg">
              Send reset link
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-text-secondary">
          Remembered it?{' '}
          <Link href="/login" className="text-text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
