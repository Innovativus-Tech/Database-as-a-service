'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRequireAuth, useAuth } from '@/lib/auth';

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

const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  provisioning: 'bg-amber-50 text-amber-700 ring-amber-200',
  stopped: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function DashboardPage() {
  const { loading: authLoading } = useRequireAuth();
  const { logout } = useAuth();
  const [databases, setDatabases] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    api.listDatabases()
      .then((r) => setDatabases(r.databases))
      .catch((err) => {
        if (err.status === 401) logout();
        else setError(err.message);
      });
  }, [authLoading, logout]);

  if (authLoading || databases === null) {
    return <p className="text-slate-500">Loading...</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your databases</h1>
        <Link
          href="/databases/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          + New database
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {databases.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-slate-600">No databases yet.</p>
          <Link href="/databases/new" className="mt-3 inline-block text-slate-900 underline">
            Create your first database
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {databases.map((db) => (
            <li key={db.id}>
              <Link
                href={`/databases/${db.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="font-medium">{db.name}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLES[db.status] || STATUS_STYLES.stopped}`}>
                        {db.status}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        {db.type === 'nosql' ? 'MongoDB' : 'PostgreSQL'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {db.host}:{db.port} · {fmtBytes(db.storageUsed)}
                    </p>
                  </div>
                  <span className="text-slate-400">→</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
