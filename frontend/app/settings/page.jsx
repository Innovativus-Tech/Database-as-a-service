'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check, Monitor, Smartphone, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/cn';

function fmtBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  for (const u of units) {
    if (v < 1024) return `${v.toFixed(1)} ${u}`;
    v /= 1024;
  }
  return `${v.toFixed(1)} PB`;
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

const SECTIONS = ['Profile', 'Security', 'Plan & Billing', 'Danger Zone'];

function SubNavLink({ children, active, danger, onClick }) {
  return (
    <a
      onClick={onClick}
      className={cn(
        'flex h-[34px] cursor-pointer items-center rounded px-3 text-[13px] transition-colors',
        active
          ? 'bg-accent-dim font-medium text-text-primary'
          : danger
          ? 'text-danger hover:bg-bg-inset'
          : 'text-text-secondary hover:bg-bg-inset hover:text-text-primary'
      )}
    >
      {children}
    </a>
  );
}

function FieldLabel({ children }) {
  return <label className="mb-2 block text-sm text-text-primary">{children}</label>;
}

function Toggle({ on, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative h-[22px] w-10 rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-accent' : 'bg-bg-inset border border-border-strong'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-transform',
          on ? 'translate-x-[20px]' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────
function ProfileSection({ user, onUpdated }) {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function onPickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 400_000) {
      toast.error('Image too large — pick something under 400KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.updateProfile({ avatarUrl: reader.result });
        onUpdated(res.user);
        toast.success('Photo updated');
      } catch (err) {
        toast.error(err.message);
      }
    };
    reader.readAsDataURL(file);
  }

  async function onRemoveAvatar() {
    try {
      const res = await api.updateProfile({ avatarUrl: '' });
      onUpdated(res.user);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function onSave() {
    setBusy(true);
    try {
      const res = await api.updateProfile({ displayName });
      onUpdated(res.user);
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const initial = (user.displayName || user.email || '?')[0].toUpperCase();

  return (
    <div className="max-w-[480px]">
      <div className="mb-6 text-md font-medium">Profile</div>
      <div className="mb-7 flex items-center gap-4">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-dim text-2xl font-semibold text-accent">
            {initial}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickAvatar} />
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>Upload photo</Button>
          {user.avatarUrl && (
            <button onClick={onRemoveAvatar} className="text-xs text-text-secondary hover:text-text-primary">Remove</button>
          )}
        </div>
      </div>

      <div className="mb-5 max-w-[360px]">
        <FieldLabel>Display name</FieldLabel>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
      </div>
      <div className="mb-7 max-w-[360px]">
        <FieldLabel>Email</FieldLabel>
        <div className="flex h-10 items-center gap-2 rounded border border-border bg-bg-card px-3">
          <input readOnly value={user.email} className="w-full bg-transparent text-sm text-text-secondary outline-none" />
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-success">
            <Check className="h-3 w-3" strokeWidth={2.5} />Verified
          </span>
        </div>
      </div>
      <Button onClick={onSave} loading={busy}>Save changes</Button>
    </div>
  );
}

// ── Security ────────────────────────────────────────────────────────────────
function SecuritySection({ user, onUpdated }) {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [setup, setSetup] = useState(null); // { secret, qrCode }
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState(null); // string when disabling
  const [twoFaBusy, setTwoFaBusy] = useState(false);

  const { data: sessionsData } = useQuery({ queryKey: ['sessions'], queryFn: api.getSessions });
  const sessions = sessionsData?.sessions ?? [];

  async function onChangePassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error('New passwords do not match');
    setPwBusy(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      toast.success('Password updated — other devices were signed out');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPwBusy(false);
    }
  }

  async function onRevoke(id) {
    try {
      await api.revokeSession(id);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Session revoked');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function onToggle2FA() {
    if (user.twoFactorEnabled) {
      setDisableCode('');
      return;
    }
    setTwoFaBusy(true);
    try {
      const res = await api.setup2FA();
      setSetup(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTwoFaBusy(false);
    }
  }

  async function onVerify2FA() {
    setTwoFaBusy(true);
    try {
      await api.verify2FA(code);
      onUpdated({ ...user, twoFactorEnabled: true });
      setSetup(null); setCode('');
      toast.success('Two-factor authentication enabled');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTwoFaBusy(false);
    }
  }

  async function onDisable2FA() {
    setTwoFaBusy(true);
    try {
      await api.disable2FA(disableCode);
      onUpdated({ ...user, twoFactorEnabled: false });
      setDisableCode(null);
      toast.success('Two-factor authentication disabled');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTwoFaBusy(false);
    }
  }

  return (
    <div className="max-w-[520px]">
      <div className="mb-5 text-md font-medium">Change password</div>
      <form onSubmit={onChangePassword} className="mb-8 max-w-[360px] space-y-3.5">
        <Input label="Current password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        <Input label="New password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" required />
        <Input label="Confirm new password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" required />
        <Button type="submit" variant="ghost" loading={pwBusy}>Update password</Button>
      </form>

      <div className="mb-7 h-px bg-border" />

      <div className="mb-4 text-md font-medium">Active sessions</div>
      <div className="mb-8 flex flex-col border-t border-border">
        {sessions.map((s) => {
          const isMobile = /mobile|iphone|android/i.test(s.userAgent || '');
          const Icon = isMobile ? Smartphone : Monitor;
          return (
            <div key={s.id} className="flex items-center gap-3.5 border-b border-border py-3.5">
              <Icon className="h-5 w-5 text-text-secondary" strokeWidth={1.75} />
              <div className="flex-1">
                <div className="text-sm text-text-primary">
                  {(s.userAgent || 'Unknown device').slice(0, 60)}
                  {s.current && <span className="ml-1.5 text-[11px] text-success">· This device</span>}
                </div>
                <div className="font-mono text-xs text-text-muted">{s.ip || 'unknown ip'} · {timeAgo(s.lastSeenAt)}</div>
              </div>
              {!s.current && (
                <button onClick={() => onRevoke(s.id)} className="text-sm text-danger hover:underline">Revoke</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-bg-card p-5">
        <div>
          <div className="text-base font-medium">Two-factor authentication</div>
          <div className="mt-1 text-xs text-text-secondary">Require a one-time code at sign-in.</div>
        </div>
        <Toggle on={user.twoFactorEnabled} onClick={onToggle2FA} disabled={twoFaBusy} />
      </div>

      {setup && (
        <div className="mt-5 rounded-lg border border-border bg-bg-card p-5">
          <div className="mb-3 text-sm font-medium">Scan with your authenticator app</div>
          <img src={setup.qrCode} alt="2FA QR code" className="mb-3 h-40 w-40 rounded bg-white p-2" />
          <div className="mb-3 font-mono text-xs text-text-secondary break-all">{setup.secret}</div>
          <div className="flex items-center gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="max-w-[140px] font-mono" />
            <Button onClick={onVerify2FA} loading={twoFaBusy}>Verify &amp; enable</Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {disableCode !== null && (
        <div className="mt-5 rounded-lg border border-danger/30 bg-danger/5 p-5">
          <div className="mb-3 text-sm font-medium">Enter your current code to disable 2FA</div>
          <div className="flex items-center gap-2">
            <Input value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="max-w-[140px] font-mono" />
            <Button variant="danger" onClick={onDisable2FA} loading={twoFaBusy}>Disable</Button>
            <Button variant="ghost" onClick={() => setDisableCode(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Plan & Billing ──────────────────────────────────────────────────────────
function PlanSection() {
  const { data, isLoading } = useQuery({ queryKey: ['usage'], queryFn: api.getUsage });

  function onUpgrade() {
    toast('Billing isn\'t available yet on this self-hosted instance.', {
      description: 'CustomDB Pro requires a payment processor — not wired up here. Reach out if you need higher limits.',
    });
  }

  if (isLoading || !data) return <p className="text-sm text-text-secondary">Loading...</p>;

  const dbPct = Math.min(100, (data.databaseCount / data.databaseLimit) * 100);
  const storagePct = Math.min(100, (data.storageUsed / data.storageLimit) * 100);

  return (
    <div className="max-w-[520px]">
      <div className="mb-6 flex items-center justify-between rounded-lg border border-border bg-bg-card p-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-base font-medium">Free Tier</span>
            <span className="rounded-sm border border-border-strong bg-bg-inset px-2 py-0.5 text-[11px] text-text-secondary">Current plan</span>
          </div>
          <div className="mt-1.5 text-sm text-text-secondary">
            {data.databaseLimit} databases · {fmtBytes(data.storageLimit)} storage · community support
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-text-secondary">Databases</span>
            <span className="text-text-primary">{data.databaseCount} / {data.databaseLimit}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
            <div className="h-full rounded-full bg-accent" style={{ width: `${dbPct}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-text-secondary">Storage</span>
            <span className="text-text-primary">{fmtBytes(data.storageUsed)} / {fmtBytes(data.storageLimit)}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
            <div className="h-full rounded-full bg-accent" style={{ width: `${storagePct}%` }} />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-accent/30 bg-bg-card p-5">
        <div className="text-base font-medium">Upgrade to Pro</div>
        <div className="my-3.5 flex flex-col gap-2 text-sm text-text-secondary">
          {['Unlimited databases', '100 GB storage', 'Daily automated backups', 'Priority support'].map((f) => (
            <span key={f} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-accent" strokeWidth={2} />{f}</span>
          ))}
        </div>
        <Button onClick={onUpgrade}>Upgrade to Pro — $19/mo</Button>
      </div>
    </div>
  );
}

// ── Danger Zone ─────────────────────────────────────────────────────────────
function DangerSection() {
  const router = useRouter();
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    setBusy(true);
    try {
      await api.deleteAccount();
      logout();
      toast.success('Account deleted');
      router.push('/login');
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[520px]">
      <div className="mb-5 text-md font-medium text-danger">Danger zone</div>
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />Delete account
        </div>
        <p className="mb-4 text-sm text-danger/80">
          This permanently deletes your account, every database you own, and all of their data.
          This cannot be undone.
        </p>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>Delete account</Button>
        ) : (
          <div className="max-w-[320px]">
            <p className="mb-3 text-sm text-text-primary">
              Type <span className="font-mono text-text-primary">CONFIRM</span> to proceed.
            </p>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="CONFIRM" className="mb-3 font-mono" />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setConfirming(false); setConfirmText(''); }}>Cancel</Button>
              <Button variant="danger" disabled={confirmText !== 'CONFIRM'} loading={busy} onClick={onDelete}>Delete account</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  useRequireAuth();
  const { data, isLoading } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const queryClient = useQueryClient();
  const [section, setSection] = useState('Profile');

  function onUpdated(user) {
    queryClient.setQueryData(['me'], { user });
  }

  return (
    <AppShell>
      <Topbar breadcrumbs={['Settings', section]} />
      <main className="flex gap-10 px-8 py-8">
        <div className="flex w-[180px] flex-none flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <SubNavLink key={s} active={section === s} danger={s === 'Danger Zone'} onClick={() => setSection(s)}>
              {s}
            </SubNavLink>
          ))}
        </div>
        <div className="flex-1">
          {isLoading || !data ? (
            <p className="text-sm text-text-secondary">Loading...</p>
          ) : section === 'Profile' ? (
            <ProfileSection user={data.user} onUpdated={onUpdated} />
          ) : section === 'Security' ? (
            <SecuritySection user={data.user} onUpdated={onUpdated} />
          ) : section === 'Plan & Billing' ? (
            <PlanSection />
          ) : (
            <DangerSection />
          )}
        </div>
      </main>
    </AppShell>
  );
}
