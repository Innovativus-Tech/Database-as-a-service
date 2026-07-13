'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Plus,
  Upload,
  Database,
  Leaf,
  HardDrive,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth, useAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDisplayName(email) {
  if (!email) return 'there';
  return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const STATUS_VARIANT = {
  active: 'success',
  provisioning: 'warning',
  stopped: 'gray',
  deleted: 'danger',
};

/* Mini sparkline SVG */
function Sparkline() {
  return (
    <svg width="92" height="34" viewBox="0 0 92 34" className="absolute right-5 bottom-5 opacity-70">
      <polyline
        points="0,26 14,22 28,24 42,14 56,16 70,8 92,4"
        fill="none"
        stroke="#5B6AF0"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function StatCard({ label, value, sub, icon: Icon, progress, sparkline, liveDot }) {
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="flex items-start justify-between">
        <div>
          {liveDot ? (
            <div className="flex items-center gap-2">
              <span className="live-dot" style={{ width: 6, height: 6 }} />
              <span className="text-sm text-text-secondary">{label}</span>
            </div>
          ) : (
            <div className="text-sm text-text-secondary">{label}</div>
          )}
          <div className="mt-2.5 text-[28px] font-semibold tracking-tight text-text-primary">{value}</div>
          {sub && <div className="mt-1.5 text-xs text-text-muted">{sub}</div>}
        </div>
      </div>
      {typeof progress === 'number' && (
        <div className="mt-3.5 h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
      {sparkline && <Sparkline />}
    </Card>
  );
}

function DbRow({ db, idx }) {
  const isMongo = db.type === 'nosql';
  const Icon = isMongo ? Leaf : Database;
  const typeColor = isMongo ? 'text-mongo' : 'text-postgres';

  const fmtDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: idx * 0.03 }}
      className="group flex items-center gap-4 border-b border-border px-3 transition-colors duration-150 hover:bg-bg-row"
      style={{ height: 64 }}
    >
      {/* Icon */}
      <span className={`inline-flex w-6 justify-center ${typeColor}`}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
      </span>

      {/* Name + port */}
      <div className="w-[200px]">
        <div className="text-sm font-medium text-text-primary">{db.name}</div>
        <div className="text-xs font-mono text-text-muted">:{db.port}</div>
      </div>

      {/* Engine badge */}
      <Badge variant={isMongo ? 'mongo' : 'postgres'} className="w-[120px] box-border" size="md">
        {isMongo ? 'MongoDB' : 'PostgreSQL'}
      </Badge>

      {/* Status badge */}
      <Badge variant={STATUS_VARIANT[db.status]} pulse={db.status === 'active'} size="md">
        {db.status}
      </Badge>

      <div className="flex-1" />

      {/* Date */}
      <div className="text-xs text-text-muted w-[120px]">
        {fmtDate(db.createdAt)}
      </div>

      {/* Action buttons */}
      <Link href={`/databases/${db.id}?tab=browse`}>
        <button className="h-8 px-3 border border-border rounded text-sm font-medium text-text-primary hover:bg-bg-inset transition-colors">
          Browse
        </button>
      </Link>
      <Link href={`/databases/${db.id}`}>
        <button className="h-8 px-3 border border-border rounded text-sm font-medium text-text-primary hover:bg-bg-inset transition-colors">
          Connect
        </button>
      </Link>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { loading: authLoading } = useRequireAuth();
  const { email } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
    enabled: !authLoading,
  });

  const dbs = data?.databases ?? [];
  const activeCount = dbs.filter((d) => d.status === 'active').length;
  const totalStorage = dbs.reduce((acc, d) => acc + (d.storageUsed || 0), 0);
  const mongoCount = dbs.filter(d => d.type === 'nosql').length;
  const pgCount = dbs.filter(d => d.type === 'sql').length;

  return (
    <AppShell>
      <Topbar
        breadcrumbs={['Databases', 'Overview']}
        actions={
          <Link href="/databases/new">
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />}>Create Database</Button>
          </Link>
        }
      />
      <main className="px-8 py-8">
        {/* Greeting */}
        <div className="mb-8">
          <div className="text-4xl font-bold tracking-tight text-text-primary" style={{ lineHeight: 1.05 }}>
            {getGreeting()}, {getDisplayName(email)}.
          </div>
          <div className="mt-2 text-sm text-text-secondary">
            You have {activeCount} active database{activeCount !== 1 ? 's' : ''}.
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-8">
          {isLoading ? (
            [0,1,2].map((i) => <Skeleton key={i} className="h-32" />)
          ) : (
            <>
              <StatCard
                label="Total Databases"
                value={dbs.length}
                sub={`${mongoCount} MongoDB · ${pgCount} PostgreSQL`}
                sparkline
              />
              <StatCard
                label="Disk Used"
                value={fmtBytes(totalStorage)}
                sub="includes Mongo engine files"
              />
              <StatCard
                label="Active Connections · Live now"
                value={activeCount}
                sub={`across ${dbs.length} database${dbs.length !== 1 ? 's' : ''}`}
                liveDot
              />
            </>
          )}
        </div>

        {/* DB list */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-base font-medium text-text-primary">Your databases</div>
          <Link href="/databases/new">
            <Button size="sm" leftIcon={<Plus className="h-[14px] w-[14px]" />}>Create Database</Button>
          </Link>
        </div>

        <div className="border-t border-border">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {[0,1,2].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : error ? (
            <p className="p-6 text-sm text-danger">{error.message}</p>
          ) : dbs.length === 0 ? (
            <Card className="p-2 mt-2">
              <EmptyState
                icon={Database}
                title="No databases yet"
                description="Create your first database in under 5 seconds."
                action={
                  <Link href="/databases/new">
                    <Button leftIcon={<Plus className="h-4 w-4" />}>Create Database</Button>
                  </Link>
                }
              />
            </Card>
          ) : (
            dbs.slice(0, 8).map((db, idx) => <DbRow key={db.id} db={db} idx={idx} />)
          )}
        </div>
      </main>
    </AppShell>
  );
}
