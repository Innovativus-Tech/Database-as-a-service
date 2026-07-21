'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users, Database, HardDrive, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useRequireAuth } from '@/lib/auth';
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

function StatCard({ label, value, sub, icon: Icon }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
          {sub && <div className="mt-1 text-xs text-text-secondary">{sub}</div>}
        </div>
        <Icon className="h-5 w-5 text-text-muted" strokeWidth={1.75} />
      </div>
    </Card>
  );
}

export default function AdminPage() {
  useRequireAuth();
  const router = useRouter();
  const { user, loading } = useAuth();

  // Client-side gate is UX only — the backend re-checks the admin role in
  // Postgres on every /api/admin request.
  const isAdmin = user?.role === 'admin';
  useEffect(() => {
    if (!loading && user && !user._tentative && !isAdmin) router.replace('/dashboard');
  }, [loading, user, isAdmin, router]);

  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: api.adminStats, enabled: isAdmin });
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.adminUsers, enabled: isAdmin });

  return (
    <AppShell>
      <Topbar title="Admin" subtitle="Platform overview and user management" />
      <div className="px-8 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : stats.data ? (
            <>
              <StatCard label="Users" value={stats.data.users} icon={Users} />
              <StatCard
                label="Databases"
                value={stats.data.databases.total}
                sub={`${stats.data.databases.active} active · ${stats.data.databases.sql} SQL · ${stats.data.databases.nosql} NoSQL`}
                icon={Database}
              />
              <StatCard label="Storage used" value={fmtBytes(stats.data.storageUsed)} icon={HardDrive} />
              <StatCard label="Active sessions" value={stats.data.activeSessions} icon={Activity} />
            </>
          ) : null}
        </div>

        <Card className="mt-6 overflow-hidden">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-md font-medium">Users</h2>
          </div>
          {users.isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-text-muted">
                    <th className="px-6 py-3 font-medium">User</th>
                    <th className="px-6 py-3 font-medium">Organization</th>
                    <th className="px-6 py-3 font-medium">Role</th>
                    <th className="px-6 py-3 font-medium">Databases</th>
                    <th className="px-6 py-3 font-medium">Auth</th>
                    <th className="px-6 py-3 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {(users.data?.users || []).map((u) => (
                    <tr key={u.id} className="border-b border-border last:border-0">
                      <td className="px-6 py-3">
                        <div className="font-medium text-text-primary">{u.fullName || '—'}</div>
                        <div className="text-xs text-text-secondary">{u.email}</div>
                      </td>
                      <td className="px-6 py-3 text-text-secondary">{u.organizationName || '—'}</td>
                      <td className="px-6 py-3">
                        {u.role === 'admin' ? (
                          <Badge variant="success">admin</Badge>
                        ) : (
                          <Badge>user</Badge>
                        )}
                      </td>
                      <td className="px-6 py-3 text-text-secondary">{u.databaseCount}</td>
                      <td className="px-6 py-3 text-xs text-text-secondary">
                        {[u.googleLinked && 'Google', u.twoFactorEnabled && '2FA'].filter(Boolean).join(' · ') || 'Password'}
                      </td>
                      <td className="px-6 py-3 text-text-secondary">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
