'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Check, Leaf, Database, Copy, Eye, EyeOff, HelpCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import CopyButton from '@/components/CopyButton';

const STEPS = ['Choose type', 'Configure', 'Review'];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center mb-10">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step} className="contents">
            {i > 0 && (
              <div className="flex-1 h-px bg-[rgba(255,255,255,0.10)] mx-3" />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                  done
                    ? 'bg-accent text-white'
                    : active
                    ? 'bg-accent-dim border border-accent text-accent'
                    : 'border border-border text-text-muted'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
              </div>
              <span className={`text-sm font-medium ${
                done || active ? 'text-text-primary' : 'text-text-muted'
              }`}>
                {step}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureItem({ children, color = '#10B981' }) {
  return (
    <span className="flex gap-2 items-center text-xs text-text-secondary">
      <Check className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} style={{ color }} />
      {children}
    </span>
  );
}

export default function NewDatabasePage() {
  const router = useRouter();
  const { loading: authLoading } = useRequireAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState('nosql');
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  if (authLoading) return (
    <AppShell><Topbar breadcrumbs={['Databases', 'New database']} /></AppShell>
  );

  async function onSubmit() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.createDatabase(name, type);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AppShell>
      <Topbar breadcrumbs={['Databases', 'Database created']} />
      <main className="px-8 py-8">
      <div className="mx-auto max-w-[560px] text-text-primary">
        <StepIndicator current={3} />

        <div className="text-xl font-semibold mb-2">Database created! 🎉</div>
        <p className="text-sm text-text-secondary mb-6">
          Save these credentials now — the password will be shown again on the database detail page,
          but you should treat the connection string as a secret.
        </p>

        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 mb-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-warning">Connection string</p>
          <div className="flex items-center gap-2 bg-bg-inset rounded p-3">
            <code className="flex-1 break-all font-mono text-sm text-text-primary">
              {result.connectionUrl}
            </code>
            <CopyButton value={result.connectionUrl} />
          </div>
        </div>

        {/* Auto-generated credentials */}
        <div className="bg-bg-inset border border-border rounded-lg p-4 mb-5">
          <div className="text-xs font-medium text-text-secondary mb-3">Auto-generated credentials</div>
          <div className="flex flex-col gap-2.5">
            <div>
              <label className="block text-[11px] text-text-muted mb-1">Username</label>
              <div className="flex items-center gap-2 h-9 px-2.5 bg-[#0d0d0d] border border-border rounded">
                <input readOnly value={result.credentials.username} className="flex-1 bg-transparent border-none text-text-primary font-mono text-sm outline-none" />
                <CopyButton value={result.credentials.username} label="" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-1">Password</label>
              <div className="flex items-center gap-2 h-9 px-2.5 bg-[#0d0d0d] border border-border rounded">
                <input readOnly value={result.credentials.password} className="flex-1 bg-transparent border-none text-text-primary font-mono text-sm outline-none" />
                <CopyButton value={result.credentials.password} label="" />
              </div>
            </div>
          </div>
        </div>

        {/* Review summary */}
        <div className="bg-bg-inset border border-border rounded-lg p-5 mb-5">
          <div className="flex flex-col gap-3">
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Type</span>
              <span className="text-sm text-text-primary inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${type === 'nosql' ? 'bg-mongo' : 'bg-postgres'}`} />
                {type === 'nosql' ? 'MongoDB' : 'PostgreSQL'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Name</span>
              <span className="text-sm text-text-primary font-mono">{result.database.name || name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Host</span>
              <span className="text-sm text-text-primary font-mono">{result.database.host}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-text-secondary">Port</span>
              <span className="text-sm text-text-primary font-mono">{result.database.port}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href={`/databases/${result.database.id}`}
            className="flex-1 h-12 rounded bg-accent text-white text-[15px] font-medium inline-flex items-center justify-center gap-2 hover:bg-accent-hover transition-colors"
          >
            Go to database
          </Link>
          <button
            onClick={() => router.push('/dashboard')}
            className="h-12 px-5 border border-border-strong rounded text-sm text-text-secondary font-medium hover:bg-bg-inset hover:text-text-primary transition-colors"
          >
            Dashboard
          </button>
        </div>
      </div>
      </main>
      </AppShell>
    );
  }

  const isMongo = type === 'nosql';

  return (
    <AppShell>
    <Topbar breadcrumbs={['Databases', 'New database']} />
    <main className="px-8 py-12 flex justify-center">
    <div className="w-full max-w-[560px] text-text-primary">
      <StepIndicator current={step} />

      {/* Step 0: Choose type */}
      {step === 0 && (
        <>
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted mb-3.5">Database type</div>
          <div className="grid grid-cols-2 gap-3.5 mb-10">
            {/* MongoDB card */}
            <div
              onClick={() => setType('nosql')}
              className={`relative rounded-lg p-5 cursor-pointer transition-all ${
                type === 'nosql'
                  ? 'bg-mongo/[0.06] border border-mongo'
                  : 'bg-[#111111] border border-border hover:border-border-strong hover:bg-[#181818]'
              }`}
            >
              {type === 'nosql' && (
                <div className="absolute top-3.5 right-3.5 w-5 h-5 rounded-full bg-mongo flex items-center justify-center">
                  <Check className="h-[13px] w-[13px] text-bg-base" strokeWidth={2.5} />
                </div>
              )}
              <div className="w-10 h-10 rounded-full bg-mongo/[0.12] flex items-center justify-center text-mongo mb-3.5">
                <Leaf className="h-[22px] w-[22px]" strokeWidth={1.75} />
              </div>
              <div className="text-base font-semibold">MongoDB</div>
              <div className="text-xs text-text-secondary mt-0.5">NoSQL · Document database</div>
              <div className="h-px bg-border my-3.5" />
              <div className="flex flex-col gap-2">
                <FeatureItem color="#10B981">Flexible JSON schema</FeatureItem>
                <FeatureItem color="#10B981">Horizontal scaling</FeatureItem>
                <FeatureItem color="#10B981">Best for: APIs, real-time apps</FeatureItem>
              </div>
            </div>

            {/* PostgreSQL card */}
            <div
              onClick={() => setType('sql')}
              className={`relative rounded-lg p-5 cursor-pointer transition-all ${
                type === 'sql'
                  ? 'bg-postgres/[0.06] border border-postgres'
                  : 'bg-[#111111] border border-border hover:border-border-strong hover:bg-[#181818]'
              }`}
            >
              {type === 'sql' && (
                <div className="absolute top-3.5 right-3.5 w-5 h-5 rounded-full bg-postgres flex items-center justify-center">
                  <Check className="h-[13px] w-[13px] text-white" strokeWidth={2.5} />
                </div>
              )}
              <div className="w-10 h-10 rounded-full bg-postgres/[0.12] flex items-center justify-center text-postgres mb-3.5">
                <Database className="h-[22px] w-[22px]" strokeWidth={1.75} />
              </div>
              <div className="text-base font-semibold">PostgreSQL</div>
              <div className="text-xs text-text-secondary mt-0.5">SQL · Relational database</div>
              <div className="h-px bg-border my-3.5" />
              <div className="flex flex-col gap-2">
                <FeatureItem color="#3B82F6">Relational schema</FeatureItem>
                <FeatureItem color="#3B82F6">ACID transactions</FeatureItem>
                <FeatureItem color="#3B82F6">Best for: analytics, SaaS</FeatureItem>
              </div>
            </div>
          </div>

          <button
            onClick={() => setStep(1)}
            className="w-full h-12 rounded bg-accent text-white text-[15px] font-medium hover:bg-accent-hover transition-colors"
          >
            Continue
          </button>
        </>
      )}

      {/* Step 1: Configure */}
      {step === 1 && (
        <>
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted mb-3.5">Configure</div>

          <div className="mb-5">
            <label className="flex items-center gap-1.5 text-sm text-text-primary mb-2">
              Database name
              <HelpCircle className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.75} />
            </label>
            <div className="flex items-center h-10 px-3 bg-bg-inset border border-accent rounded focus-within:shadow-[0_0_0_3px_rgba(91,106,240,0.18)]">
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-app-db"
                pattern="[a-zA-Z][a-zA-Z0-9_-]{2,39}"
                className="w-full bg-transparent border-none text-text-primary font-mono text-sm outline-none placeholder:text-text-muted"
              />
            </div>
            <div className="text-xs text-text-muted mt-2">Lowercase letters, numbers, and hyphens only.</div>
          </div>

          {/* Live connection string preview */}
          {name && (
            <div className="bg-[#0d0d0d] border border-border rounded-lg p-3.5 mb-5">
              <div className="text-xs text-text-secondary mb-2">Your connection string</div>
              <div className="font-mono text-sm text-text-secondary break-all">
                <span className="text-accent">{isMongo ? 'mongodb://' : 'postgresql://'}</span>
                admin:<span className="text-text-muted">●●●●●●</span>@
                {isMongo ? 'db-host-assigned-on-create' : 'dbaas.example.com'}:
                {isMongo ? '27017' : 'assigned'}/
                <span className="text-mongo">{name}</span>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger mb-3">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(0)}
              className="h-12 px-5 border border-border-strong rounded text-sm text-text-secondary font-medium hover:bg-bg-inset hover:text-text-primary transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => { if (name.trim()) setStep(2); }}
              disabled={!name.trim()}
              className="flex-1 h-12 rounded bg-accent text-white text-[15px] font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              Continue
            </button>
          </div>
        </>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <>
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted mb-3.5">Review</div>

          <div className="bg-bg-inset border border-border rounded-lg p-5 mb-5">
            <div className="flex flex-col gap-3">
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Type</span>
                <span className="text-sm text-text-primary inline-flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isMongo ? 'bg-mongo' : 'bg-postgres'}`} />
                  {isMongo ? 'MongoDB' : 'PostgreSQL'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Name</span>
                <span className="text-sm text-text-primary font-mono">{name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Port</span>
                <span className="text-sm text-text-primary font-mono">
                  {isMongo ? '27017' : 'auto-assigned'} <span className="text-text-muted">({isMongo ? 'shared gateway' : 'from range'})</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Host</span>
                <span className="text-sm text-text-primary font-mono">
                  {(process.env.NEXT_PUBLIC_API_URL || '').replace(/^https?:\/\/(api\.)?/, '') || 'assigned on create'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-text-secondary">Storage</span>
                <span className="text-sm text-text-primary">Self-hosted · no cap</span>
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-danger mb-3">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="h-12 px-5 border border-border-strong rounded text-sm text-text-secondary font-medium hover:bg-bg-inset hover:text-text-primary transition-colors"
            >
              Back
            </button>
            <button
              onClick={onSubmit}
              disabled={busy}
              className="flex-1 h-12 rounded bg-accent text-white text-[15px] font-medium inline-flex items-center justify-center gap-2 hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {busy ? 'Creating...' : 'Create Database'}
            </button>
          </div>

          <div className="text-xs text-text-muted text-center mt-3">
            This will start a new Docker container on your VPS.
          </div>
        </>
      )}
    </div>
    </main>
    </AppShell>
  );
}
