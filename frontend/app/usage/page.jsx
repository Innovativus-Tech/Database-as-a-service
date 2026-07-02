'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { HardDrive, Database, Leaf, Activity, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';

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

function fmtUptime(startedAt) {
  if (!startedAt) return '—';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 60)         return `${mins}m`;
  if (mins < 60 * 24)    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${Math.floor(mins / (60 * 24))}d ${Math.floor((mins / 60) % 24)}h`;
}

function StatCard({ label, value, sub, icon: Icon, progress }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
          {sub && <div className="mt-1 text-xs text-text-secondary">{sub}</div>}
        </div>
        {Icon && (
          <div className="rounded-lg bg-bg-inset p-2 text-text-secondary">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </div>
        )}
      </div>
      {typeof progress === 'number' && (
        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-bg-inset">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
    </Card>
  );
}

export default function UsagePage() {
  useRequireAuth();
  const { data: list, isLoading } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
  });
  const dbs = list?.databases ?? [];

  // Pull live stats per DB in parallel
  const statQueries = useQueries({
    queries: dbs.map((db) => ({
      queryKey: ['db-stats', db.id],
      queryFn: () => api.getStats(db.id),
      enabled: !!db.id,
      staleTime: 15_000,
    })),
  });

  const totalStorage = statQueries.reduce((acc, q) => acc + (q.data?.storage?.bytes || 0), 0);
  const activeCount = statQueries.filter((q) => q.data?.container?.running).length;

  return (
    <AppShell>
      <Topbar title="Usage & Stats" subtitle="Storage, uptime, and per-database activity" />
      <main className="px-8 py-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {isLoading ? (
            [0,1,2].map(i => <Skeleton key={i} className="h-32" />)
          ) : (
            <>
              <StatCard
                label="Total Databases"
                value={dbs.length}
                sub={`${dbs.filter(d => d.type === 'nosql').length} Mongo · ${dbs.filter(d => d.type === 'sql').length} Postgres`}
                icon={Database}
              />
              <StatCard
                label="Storage Used"
                value={fmtBytes(totalStorage)}
                sub="self-hosted · no cap"
                icon={HardDrive}
              />
              <StatCard
                label="Active Now"
                value={activeCount}
                sub={`${dbs.length - activeCount} stopped / restarting`}
                icon={Activity}
              />
            </>
          )}
        </div>

        <div className="mt-8">
          <h2 className="mb-3 text-lg font-medium tracking-tight">Per-database activity</h2>
          <Card className="p-2">
            <div className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">
              <div className="grid grid-cols-12 items-center gap-3">
                <div className="col-span-4">Name</div>
                <div className="col-span-2">Container</div>
                <div className="col-span-2">Storage</div>
                <div className="col-span-2">Uptime</div>
                <div className="col-span-2 text-right">Restarts</div>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {isLoading ? (
                [0,1,2].map(i => <li key={i} className="p-3"><Skeleton className="h-8" /></li>)
              ) : dbs.length === 0 ? (
                <li className="p-6 text-center text-sm text-text-secondary">No databases yet.</li>
              ) : (
                dbs.map((db, idx) => {
                  const stats = statQueries[idx]?.data;
                  const isMongo = db.type === 'nosql';
                  const Icon = isMongo ? Leaf : Database;
                  return (
                    <motion.li
                      key={db.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.15, delay: idx * 0.02 }}
                      className="px-3 py-3 transition-colors hover:bg-bg-row"
                    >
                      <Link href={`/databases/${db.id}`} className="grid grid-cols-12 items-center gap-3">
                        <div className="col-span-4 flex items-center gap-3">
                          <Icon className={`h-4 w-4 ${isMongo ? 'text-mongo' : 'text-postgres'}`} strokeWidth={1.75} />
                          <div>
                            <div className="text-sm font-medium">{db.name}</div>
                            <div className="font-mono text-xs text-text-muted">{db.host}:{db.port}</div>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <Badge variant={stats?.container?.running ? 'success' : 'gray'} pulse={!!stats?.container?.running}>
                            {stats?.container?.state || 'unknown'}
                          </Badge>
                        </div>
                        <div className="col-span-2 font-mono text-xs text-text-secondary">
                          {stats?.storage?.human || fmtBytes(stats?.storage?.bytes || 0)}
                        </div>
                        <div className="col-span-2 font-mono text-xs text-text-secondary">
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtUptime(stats?.container?.startedAt)}</span>
                        </div>
                        <div className="col-span-2 text-right font-mono text-xs text-text-secondary">
                          {stats?.container?.restartCount ?? 0}
                        </div>
                      </Link>
                    </motion.li>
                  );
                })
              )}
            </ul>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}
