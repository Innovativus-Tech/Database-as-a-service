'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Search, Database, Leaf, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
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

const STATUS_VARIANT = {
  active: 'success', provisioning: 'warning', stopped: 'gray', deleted: 'danger',
};

function FilterPill({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-bg-card text-text-primary ring-1 ring-inset ring-border-strong'
          : 'text-text-secondary hover:bg-bg-inset hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

function Row({ db, idx }) {
  const isMongo = db.type === 'nosql';
  const Icon = isMongo ? Leaf : Database;
  const typeColor = isMongo ? 'text-mongo' : 'text-postgres';
  const typeBg    = isMongo ? 'bg-mongo/10' : 'bg-postgres/10';
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: idx * 0.025 }}
    >
      <Link
        href={`/databases/${db.id}`}
        className="group flex items-center gap-4 rounded-lg border border-transparent px-4 py-3 transition-all duration-150 hover:border-border hover:bg-bg-row"
      >
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${typeBg}`}>
          <Icon className={`h-5 w-5 ${typeColor}`} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text-primary">{db.name}</div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-text-muted">
            <span>{db.host}:{db.port}</span>
            <span>·</span>
            <span>{fmtBytes(db.storageUsed)}</span>
            <span>·</span>
            <span>{new Date(db.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[db.status]} pulse={db.status === 'active'}>
          {db.status}
        </Badge>
        <span className="text-xs uppercase tracking-wide text-text-muted">
          {isMongo ? 'MongoDB' : 'PostgreSQL'}
        </span>
        <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary" strokeWidth={1.75} />
      </Link>
    </motion.li>
  );
}

export default function DatabasesPage() {
  useRequireAuth();
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
  });

  const dbs = data?.databases ?? [];

  const filtered = useMemo(() => {
    return dbs.filter((d) => {
      if (typeFilter !== 'all' && d.type !== typeFilter) return false;
      if (q.trim() && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [dbs, q, typeFilter]);

  return (
    <AppShell>
      <Topbar
        breadcrumbs={['Databases', 'My Databases']}
        actions={
          <Link href="/databases/new">
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>New Database</Button>
          </Link>
        }
      />
      <main className="px-8 py-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="max-w-sm flex-1">
            <Input
              leftIcon={<Search className="h-4 w-4" />}
              placeholder="Search by name..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1 rounded border border-border bg-bg-card p-1">
            <FilterPill active={typeFilter === 'all'}   onClick={() => setTypeFilter('all')}>All</FilterPill>
            <FilterPill active={typeFilter === 'nosql'} onClick={() => setTypeFilter('nosql')}>MongoDB</FilterPill>
            <FilterPill active={typeFilter === 'sql'}   onClick={() => setTypeFilter('sql')}>PostgreSQL</FilterPill>
          </div>
        </div>

        <Card className="p-2">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : error ? (
            <p className="p-6 text-sm text-danger">{error.message}</p>
          ) : filtered.length === 0 ? (
            dbs.length === 0 ? (
              <EmptyState
                icon={Database}
                title="No databases yet"
                description="Create your first database in under 5 seconds."
                action={<Link href="/databases/new"><Button leftIcon={<Plus className="h-4 w-4" />}>New Database</Button></Link>}
              />
            ) : (
              <EmptyState
                icon={Search}
                title="No matches"
                description={`Nothing matched "${q || typeFilter}". Try a different filter.`}
              />
            )
          ) : (
            <ul>
              {filtered.map((db, idx) => <Row key={db.id} db={db} idx={idx} />)}
            </ul>
          )}
        </Card>
      </main>
    </AppShell>
  );
}
