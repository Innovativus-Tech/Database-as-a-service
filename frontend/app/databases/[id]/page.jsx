'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRequireAuth, useAuth } from '@/lib/auth';
import CopyButton from '@/components/CopyButton';

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

export default function DatabaseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { loading: authLoading } = useRequireAuth();
  const { logout } = useAuth();

  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);
  const targetInputRef = useRef(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (authLoading || !id) return;
    Promise.all([api.getDatabase(id), api.getStats(id)])
      .then(([d, s]) => { setDetail(d); setStats(s); })
      .catch((err) => {
        if (err.status === 401) { logout(); router.replace('/login'); return; }
        if (err.status === 404) { router.replace('/dashboard'); return; }
        setError(err.message);
      });
  }, [authLoading, id, logout, router]);

  async function refreshStats() {
    try { setStats(await api.getStats(id)); } catch {}
  }

  async function onImport(e) {
    e.preventDefault();
    setImportError(null);
    setImportResult(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setImportError('Choose a file first'); return; }
    setImportBusy(true);
    try {
      const target = targetInputRef.current?.value?.trim() || undefined;
      const res = await api.importFile(id, file, target);
      setImportResult(res);
      fileInputRef.current.value = '';
      refreshStats();
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImportBusy(false);
    }
  }

  async function onDelete() {
    setDeleteBusy(true);
    try {
      await api.deleteDatabase(id);
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
      setDeleteBusy(false);
    }
  }

  if (authLoading || (!detail && !error)) {
    return <p className="text-slate-500">Loading...</p>;
  }
  if (error) return <p className="text-red-600">{error}</p>;

  const db = detail.database;
  const cred = detail.credentials;
  const url = detail.connectionUrl;
  const maskedUrl = url.replace(`:${encodeURIComponent(cred.password)}@`, ':••••••••@');

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">← Dashboard</Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-mono">{db.name}</h1>
          <span className="text-xs uppercase tracking-wide text-slate-500">
            {db.type === 'nosql' ? 'MongoDB' : 'PostgreSQL'}
          </span>
        </div>
      </div>

      {/* Connection */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">Connection</h2>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-slate-50 p-3 font-mono text-sm">
            {showPassword ? url : maskedUrl}
          </code>
          <CopyButton value={url} />
          <button
            onClick={() => setShowPassword((v) => !v)}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Host</dt><dd className="font-mono">{db.host}</dd></div>
          <div><dt className="text-slate-500">Port</dt><dd className="font-mono">{db.port}</dd></div>
          <div><dt className="text-slate-500">Username</dt><dd className="font-mono">{cred.username}</dd></div>
          <div><dt className="text-slate-500">Status</dt><dd className="font-mono">{db.status}</dd></div>
        </dl>
      </section>

      {/* Stats */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Stats</h2>
          <button onClick={refreshStats} className="text-xs text-slate-500 hover:text-slate-900">Refresh</button>
        </div>
        {stats ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Container</dt><dd className="font-mono">{stats.container?.state || 'unknown'}</dd></div>
            <div><dt className="text-slate-500">Running</dt><dd className="font-mono">{String(stats.container?.running ?? false)}</dd></div>
            <div><dt className="text-slate-500">Storage</dt><dd className="font-mono">{stats.storage?.human || fmtBytes(stats.storage?.bytes || 0)}</dd></div>
            <div><dt className="text-slate-500">Restarts</dt><dd className="font-mono">{stats.container?.restartCount ?? 0}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Loading stats...</p>
        )}
      </section>

      {/* Import */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-slate-500">Import data</h2>
        <p className="mb-4 text-sm text-slate-600">
          {db.type === 'nosql'
            ? 'Accepted: .json, .csv, or a mongodump .zip.'
            : 'Accepted: .csv (auto-creates a table) or a pg_dump .sql file.'}
        </p>
        <form onSubmit={onImport} className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={db.type === 'nosql' ? '.json,.csv,.zip' : '.csv,.sql'}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-slate-700"
          />
          <input
            ref={targetInputRef}
            type="text"
            placeholder="Target collection/table (optional, defaults to filename)"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono focus:border-slate-500 focus:outline-none"
          />
          {importError && <p className="text-sm text-red-600">{importError}</p>}
          {importResult && (
            <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
              <div className="font-medium">Imported {importResult.kind}</div>
              <div className="text-xs">
                file: {importResult.file} → target: {importResult.target}
                {importResult.count != null && <> · {importResult.count} rows</>}
              </div>
              {importResult.log && (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs">{importResult.log}</pre>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={importBusy}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {importBusy ? 'Importing...' : 'Upload & import'}
          </button>
        </form>
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-red-200 bg-red-50 p-5">
        <h2 className="mb-1 text-sm font-medium uppercase tracking-wide text-red-700">Danger zone</h2>
        <p className="mb-3 text-sm text-red-800">
          Deleting will stop the container, drop the data volume, and remove the metadata. This cannot be undone.
        </p>
        {confirmingDelete ? (
          <div className="flex items-center gap-3">
            <button
              onClick={onDelete}
              disabled={deleteBusy}
              className="rounded-md bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteBusy ? 'Deleting...' : `Yes, delete ${db.name}`}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-white"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-100"
          >
            Delete database
          </button>
        )}
      </section>
    </div>
  );
}
