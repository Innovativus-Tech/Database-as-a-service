'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Database, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import AdminDataBrowser from '@/components/admin/AdminDataBrowser';

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

export default function AdminDatabaseDetailPage() {
  useRequireAuth();
  const router = useRouter();
  const { id } = useParams();
  const { user, loading } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [db, setDb] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!loading && user && !user._tentative && !isAdmin) router.replace('/dashboard');
  }, [loading, user, isAdmin, router]);

  // The list endpoint carries owner info; find this database in it. (There's no
  // single-database admin detail endpoint — the list is small and already
  // authorized, so we reuse it.)
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    api.adminListDatabases()
      .then((r) => {
        if (!alive) return;
        const found = (r.databases || []).find((d) => d.id === id);
        if (!found) setError('Database not found');
        else setDb(found);
      })
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, [isAdmin, id]);

  return (
    <AppShell>
      <Topbar breadcrumbs={['Admin', 'Databases', db?.name || '…']} />
      <div className="px-8 py-8">
        <Link href="/admin" className="mb-6 inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to Admin
        </Link>

        {error && <p className="text-sm text-danger">{error}</p>}

        {db && (
          <>
            <Card className="mb-6 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-text-muted" strokeWidth={1.75} />
                    <span className="text-lg font-semibold tracking-tight">{db.name}</span>
                    <Badge variant={db.type === 'sql' ? 'postgres' : 'mongo'}>
                      {db.type === 'sql' ? 'PostgreSQL' : 'MongoDB'}
                    </Badge>
                    <Badge variant={db.status === 'active' ? 'success' : 'gray'}>{db.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
                    <User className="h-4 w-4" strokeWidth={1.75} />
                    <span>{db.owner.fullName || db.owner.email}</span>
                    <span className="text-text-muted">·</span>
                    <span className="text-text-muted">{db.owner.email}</span>
                    {db.owner.organizationName && (
                      <>
                        <span className="text-text-muted">·</span>
                        <span className="text-text-muted">{db.owner.organizationName}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-text-muted">Storage</div>
                  <div className="font-medium text-text-primary">{fmtBytes(db.storageUsed)}</div>
                </div>
              </div>
            </Card>

            {db.status === 'active' ? (
              <Card className="p-6">
                <h2 className="mb-4 text-md font-medium">Stored data (read-only)</h2>
                <AdminDataBrowser databaseId={db.id} dbType={db.type} />
              </Card>
            ) : (
              <p className="text-sm text-text-secondary">
                This database is not active, so its data can't be browsed right now.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
