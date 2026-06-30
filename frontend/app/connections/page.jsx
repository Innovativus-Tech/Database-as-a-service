'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Database, Leaf, Eye, EyeOff, Copy, Check, ExternalLink, Link2, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/cn';

function maskUrl(url) {
  if (!url) return '';
  return url.replace(/:([^:@/]+)@/, ':••••••••@');
}

// Convert a standard connection URL into the @customdb/client SDK URL by
// swapping the scheme. Customers paste THIS one into the SDK and get
// transparent Redis caching for free.
function toSdkUrl(standardUrl, isMongo) {
  if (!standardUrl) return '';
  return isMongo
    ? standardUrl.replace(/^mongodb:\/\//, 'customdb://')
    : standardUrl.replace(/^postgresql:\/\//, 'customdb-pg://');
}

function CopyableField({ value, masked, label, hint }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</span>
          {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
        </div>
      )}
      <div className="flex items-center gap-2 rounded border border-border bg-bg-inset px-3 py-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-text-primary">
          {revealed ? value : maskUrl(value)}
        </code>
        <button
          onClick={() => setRevealed((v) => !v)}
          className="rounded p-1 text-text-secondary hover:bg-bg-card hover:text-text-primary"
          aria-label={revealed ? 'Hide' : 'Show'}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={onCopy}
          className="rounded p-1 text-text-secondary hover:bg-bg-card hover:text-text-primary"
          aria-label="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function CodeBlock({ code, label }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div className="overflow-hidden rounded border border-border bg-bg-inset">
      {label && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</span>
          <button onClick={onCopy} className="rounded p-1 text-text-secondary hover:bg-bg-card hover:text-text-primary" aria-label="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-text-primary">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 rounded-md border border-border bg-bg-inset p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
            value === t.value
              ? 'bg-bg-card text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ConnectionCard({ db, idx }) {
  const [tab, setTab] = useState('sdk'); // 'sdk' or 'standard'
  const isMongo = db.type === 'nosql';
  const Icon = isMongo ? Leaf : Database;
  const typeColor = isMongo ? 'text-mongo' : 'text-postgres';
  const typeBg    = isMongo ? 'bg-mongo/10' : 'bg-postgres/10';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['db-detail', db.id],
    queryFn: () => api.getDatabase(db.id),
    staleTime: 60_000,
  });

  const standardUrl = data?.connectionUrl;
  const sdkUrl = toSdkUrl(standardUrl, isMongo);
  const username = data?.credentials?.username || '—';

  const installCmd = isMongo
    ? 'npm install @customdb/client mongodb'
    : 'npm install @customdb/client pg';

  const usageSnippet = isMongo
    ? `const { CustomDBMongo } = require('@customdb/client');

const db = new CustomDBMongo(process.env.CUSTOMDB_URL);

// Reads are cached in Redis (~60s TTL), automatic.
const articles = await db.collection('articles')
  .find({ published: true });

// Writes invalidate the cache automatically.
await db.collection('articles')
  .insertOne({ title: 'Hello' });`
    : `const { CustomDBPostgres } = require('@customdb/client');

const pg = new CustomDBPostgres({
  connectionString: process.env.CUSTOMDB_URL,
});

// SELECT results are cached in Redis (~60s TTL), automatic.
const { rows } = await pg.query(
  'SELECT * FROM articles WHERE published = $1', [true]
);

// INSERT/UPDATE/DELETE invalidate the cache automatically.
await pg.query(
  'UPDATE articles SET title = $1 WHERE id = $2',
  ['Updated', 42]
);`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: idx * 0.03 }}
    >
      <Card className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${typeBg}`}>
              <Icon className={`h-4 w-4 ${typeColor}`} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{db.name}</div>
              <div className="text-xs text-text-muted">{isMongo ? 'MongoDB' : 'PostgreSQL'} · {db.host}:{db.port}</div>
            </div>
          </div>
          <Badge variant={db.status === 'active' ? 'success' : 'gray'} pulse={db.status === 'active'}>
            {db.status}
          </Badge>
        </div>

        {isLoading ? (
          <Skeleton className="h-32" />
        ) : isError ? (
          <p className="text-xs text-danger">Failed to load connection</p>
        ) : (
          <>
            <Tabs
              tabs={[
                { value: 'sdk',      label: 'CustomDB SDK · cached' },
                { value: 'standard', label: 'Standard · raw' },
              ]}
              value={tab}
              onChange={setTab}
            />

            {tab === 'sdk' ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] text-text-secondary">
                  <Zap className="mt-0.5 h-3 w-3 flex-shrink-0 text-accent" strokeWidth={2} />
                  <span>Use this with <code className="font-mono text-text-primary">@customdb/client</code> for automatic Redis caching. One connection string handles both database and cache — your customers' Redis URL is never exposed.</span>
                </div>
                <CopyableField value={sdkUrl} label="Connection URL" />
                <CodeBlock code={installCmd} label="Install" />
                <CodeBlock code={usageSnippet} label="Use it" />
                <div className="text-[11px] text-text-muted">
                  Username: <span className="font-mono text-text-secondary">{username}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded border border-border bg-bg-inset px-3 py-2 text-[11px] text-text-secondary">
                  <span>Standard connection URL — works with any {isMongo ? 'MongoDB' : 'PostgreSQL'} driver, Compass, mongosh{isMongo ? '' : ', psql'}, etc. No caching layer.</span>
                </div>
                <CopyableField value={standardUrl} label="Connection URL" />
                <div className="text-[11px] text-text-muted">
                  Username: <span className="font-mono text-text-secondary">{username}</span>
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
          <Link href={`/databases/${db.id}`} className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
            Details <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </Card>
    </motion.div>
  );
}

export default function ConnectionsPage() {
  useRequireAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
  });
  const dbs = data?.databases ?? [];

  return (
    <AppShell>
      <Topbar
        title="Connection Strings"
        subtitle="Standard URLs for any tool, plus SDK URLs with built-in caching."
      />
      <main className="px-8 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-80 rounded-lg" />)}
          </div>
        ) : dbs.length === 0 ? (
          <Card>
            <EmptyState
              icon={Link2}
              title="No connection strings"
              description="Create your first database to get a connection URL."
              action={<Link href="/databases/new"><Button>New Database</Button></Link>}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {dbs.map((db, idx) => <ConnectionCard key={db.id} db={db} idx={idx} />)}
          </div>
        )}
      </main>
    </AppShell>
  );
}
