'use client';

import { useState } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Database, Leaf, Eye, EyeOff, Copy, Check, ExternalLink, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';

function maskUrl(url) {
  if (!url) return '';
  return url.replace(/:([^:@/]+)@/, ':••••••••@');
}

function ConnectionCard({ db, idx }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied]     = useState(false);
  const isMongo = db.type === 'nosql';
  const Icon = isMongo ? Leaf : Database;
  const typeColor = isMongo ? 'text-mongo' : 'text-postgres';
  const typeBg    = isMongo ? 'bg-mongo/10' : 'bg-postgres/10';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['db-detail', db.id],
    queryFn: () => api.getDatabase(db.id),
    staleTime: 60_000,
  });

  const url = data?.connectionUrl;

  async function onCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: idx * 0.03 }}
    >
      <Card className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
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
          <Skeleton className="h-9" />
        ) : isError ? (
          <p className="text-xs text-danger">Failed to load connection</p>
        ) : (
          <div className="flex items-center gap-2 rounded border border-border bg-bg-inset px-3 py-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-text-primary">
              {revealed ? url : maskUrl(url)}
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
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-text-muted">
            User: <span className="font-mono text-text-secondary">{data?.credentials?.username || '—'}</span>
          </span>
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
        subtitle="One-tap copy for every database"
      />
      <main className="px-8 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-36 rounded-lg" />)}
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {dbs.map((db, idx) => <ConnectionCard key={db.id} db={db} idx={idx} />)}
          </div>
        )}
      </main>
    </AppShell>
  );
}
