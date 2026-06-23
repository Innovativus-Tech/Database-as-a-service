'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft, Table2, Upload, RotateCw, Trash2, Copy, Eye, EyeOff, Leaf, Database,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth, useAuth } from '@/lib/auth';
import CopyButton from '@/components/CopyButton';
import DataBrowser from '@/components/DataBrowser';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Badge from '@/components/ui/Badge';

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

const TABS = ['Overview', 'Browse Data', 'Import', 'Settings'];

export default function DatabaseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { loading: authLoading } = useRequireAuth();
  const { logout } = useAuth();

  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);
  const targetInputRef = useRef(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);

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

  async function onRestart() {
    setRestartBusy(true);
    try {
      const res = await api.startDatabase(id);
      const messages = {
        running: 'Container is already running.',
        started: 'Container was stopped — started it back up.',
        recreated: 'Container was missing — recreated it from existing data.',
      };
      toast.success(messages[res.action] || 'Container is up.');
      await refreshStats();
    } catch (err) {
      toast.error(err.message || 'Failed to restart container');
    } finally {
      setRestartBusy(false);
    }
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
    return <AppShell><Topbar breadcrumbs={['Databases', '...']} /></AppShell>;
  }
  if (error) return (
    <AppShell><Topbar breadcrumbs={['Databases', 'Error']} />
      <main className="px-8 py-8"><p className="text-danger">{error}</p></main>
    </AppShell>
  );

  const db = detail.database;
  const cred = detail.credentials;
  const url = detail.connectionUrl;
  const maskedUrl = url.replace(`:${encodeURIComponent(cred.password)}@`, ':••••••@');
  const isMongo = db.type === 'nosql';
  const Icon = isMongo ? Leaf : Database;
  const iconColor = isMongo ? 'text-mongo' : 'text-postgres';

  return (
    <AppShell>
      <Topbar breadcrumbs={['Databases', db.name]} />
      <main className="px-8 py-8 text-text-primary">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-4"
        >
          <ArrowLeft className="h-[15px] w-[15px]" strokeWidth={1.75} />
          Databases
        </Link>

        {/* Header: icon + name + status + actions */}
        <div className="flex items-center gap-3.5 mb-6">
          <span className={`inline-flex ${iconColor}`}>
            <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
          </span>
          <span className="text-xl font-semibold">{db.name}</span>
          <Badge variant="success" pulse={db.status === 'active'} size="md">
            {db.status}
          </Badge>
          <div className="flex-1" />
          <Link href={`/databases/${id}`} onClick={() => setActiveTab('Browse Data')}>
            <button className="h-9 px-3.5 border-none rounded bg-accent text-white text-sm font-medium inline-flex items-center gap-[7px] hover:bg-accent-hover transition-colors">
              <Table2 className="h-4 w-4" strokeWidth={1.75} />Browse Data
            </button>
          </Link>
          <button
            onClick={() => setActiveTab('Import')}
            className="h-9 px-3.5 border border-border rounded bg-transparent text-text-primary text-sm font-medium inline-flex items-center gap-[7px] hover:bg-bg-inset transition-colors"
          >
            <Upload className="h-4 w-4" strokeWidth={1.75} />Import
          </button>
          <button
            onClick={onRestart}
            disabled={restartBusy}
            className="h-9 px-3.5 border border-border rounded bg-transparent text-text-primary text-sm font-medium inline-flex items-center gap-[7px] hover:bg-bg-inset disabled:opacity-50 transition-colors"
          >
            <RotateCw className={`h-4 w-4 ${restartBusy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
            {restartBusy ? 'Restarting...' : 'Restart'}
          </button>
          <button
            onClick={() => { setActiveTab('Settings'); setConfirmingDelete(true); }}
            className="h-9 px-3.5 border border-danger/30 rounded bg-transparent text-danger text-sm font-medium inline-flex items-center gap-[7px] hover:bg-danger/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />Delete
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-border mb-7">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-text-primary border-b-2 border-accent -mb-px'
                  : 'text-text-secondary hover:text-text-primary cursor-pointer'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'Overview' && (
          <div className="grid gap-5" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
            {/* Left column */}
            <div className="flex flex-col gap-5">
              {/* Connection string card */}
              <div className="bg-[#111111] border border-border rounded-lg p-5">
                <div className="text-sm font-medium mb-3">Primary connection string</div>
                <div className="flex items-center gap-3 bg-[#0d0d0d] border border-border rounded-lg p-3">
                  <span className="flex-1 font-mono text-sm text-text-primary break-all">
                    {showPassword ? url : maskedUrl}
                  </span>
                  <button
                    onClick={() => setShowPassword(v => !v)}
                    className="text-sm text-text-secondary hover:text-text-primary whitespace-nowrap"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                  <CopyButton value={url} />
                </div>
                <div className="text-xs text-text-muted mt-2.5">Connected via port {db.port}</div>
              </div>

              {/* Code snippet card */}
              <div className="bg-[#111111] border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3 pb-0">
                  <div className="flex gap-[18px]">
                    <span className="text-sm font-medium text-text-primary border-b-2 border-accent pb-2.5">
                      {isMongo ? 'Node.js' : 'psql'}
                    </span>
                    <span className="text-sm font-medium text-text-secondary pb-2.5 cursor-pointer">
                      {isMongo ? 'Python' : 'Node.js'}
                    </span>
                    <span className="text-sm font-medium text-text-secondary pb-2.5 cursor-pointer">
                      {isMongo ? 'Go' : 'Python'}
                    </span>
                  </div>
                  <CopyButton value={isMongo
                    ? `import { MongoClient } from 'mongodb';\n\nconst client = new MongoClient(process.env.DATABASE_URL);\nawait client.connect();\n\nconst db = client.db('${db.name}');\nconst docs = await db.collection('users').find().toArray();`
                    : `psql "${url}"`
                  } label="Copy" />
                </div>
                <div className="border-t border-border">
                  <pre className="m-0 p-4 font-mono text-sm leading-[1.7] text-text-primary overflow-auto">
                    {isMongo ? (
                      <>
                        <span className="text-accent">import</span>{' { MongoClient } '}<span className="text-accent">from</span>{' '}<span className="text-success">{`'mongodb'`}</span>;{'\n\n'}
                        <span className="text-accent">const</span>{' client = '}<span className="text-accent">new</span>{' '}<span className="text-mongo">MongoClient</span>{'(process.env.'}<span className="text-warning">DATABASE_URL</span>{');\n'}
                        <span className="text-accent">await</span>{' client.'}<span className="text-postgres">connect</span>{'();\n\n'}
                        <span className="text-accent">const</span>{' db = client.'}<span className="text-postgres">db</span>{'('}<span className="text-success">{`'${db.name}'`}</span>{');\n'}
                        <span className="text-accent">const</span>{' docs = '}<span className="text-accent">await</span>{' db.'}<span className="text-postgres">collection</span>{'('}<span className="text-success">{`'users'`}</span>{').'}<span className="text-postgres">find</span>{'().'}<span className="text-postgres">toArray</span>{'();'}
                      </>
                    ) : (
                      <>
                        <span className="text-text-secondary"># connect with psql</span>{'\n'}
                        <span className="text-accent">psql</span>{' '}<span className="text-success">{`"${maskedUrl}"`}</span>{'\n\n'}
                        <span className="text-text-secondary"># or in your app</span>{'\n'}
                        <span className="text-accent">const</span>{' { Pool } = require('}<span className="text-success">{`'pg'`}</span>{');\n'}
                        <span className="text-accent">const</span>{' pool = '}<span className="text-accent">new</span>{' '}<span className="text-postgres">Pool</span>{'({ connectionString: process.env.'}<span className="text-warning">DATABASE_URL</span>{' });\n'}
                        <span className="text-accent">const</span>{' res = '}<span className="text-accent">await</span>{' pool.'}<span className="text-postgres">query</span>{'('}<span className="text-success">{`'SELECT * FROM users'`}</span>{');'}
                      </>
                    )}
                  </pre>
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-5">
              {/* Stats card */}
              <div className="bg-[#111111] border border-border rounded-lg p-5">
                <div className="text-sm font-medium mb-4">Stats</div>
                {stats && (
                  <>
                    <div className="mb-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-text-secondary">Storage</span>
                        <span className="text-sm text-text-primary">
                          {stats.storage?.human || fmtBytes(stats.storage?.bytes || 0)}
                        </span>
                      </div>
                      <div className="h-1 w-full bg-[rgba(255,255,255,0.06)] rounded-sm overflow-hidden">
                        <div className="h-full bg-accent rounded-sm" style={{ width: '33%' }} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-text-secondary">Container</span>
                        <span className="text-sm text-text-primary">{stats.container?.state || 'unknown'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-text-secondary">Running</span>
                        <span className="text-sm text-text-primary">{String(stats.container?.running ?? false)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-text-secondary">Restarts</span>
                        <span className="text-sm text-text-primary">{stats.container?.restartCount ?? 0}</span>
                      </div>
                    </div>
                  </>
                )}
                {!stats && <p className="text-sm text-text-secondary">Loading stats...</p>}
              </div>

              {/* Container card */}
              <div className="bg-[#111111] border border-border rounded-lg p-5">
                <div className="text-sm font-medium mb-4">Container</div>
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Image</span>
                    <span className="text-sm text-text-primary font-mono">{isMongo ? 'mongo:7.0' : 'postgres:16'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Port</span>
                    <span className="text-sm text-text-primary font-mono">{db.port}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Host</span>
                    <span className="text-sm text-text-primary font-mono">{db.host}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Username</span>
                    <span className="text-sm text-text-primary font-mono">{cred.username}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Browse Data' && (
          <DataBrowser databaseId={id} dbType={db.type} />
        )}

        {activeTab === 'Import' && (
          <div className="max-w-2xl">
            <div className="bg-[#111111] border border-border rounded-lg p-5">
              <div className="text-sm font-medium mb-1">Import data</div>
              <p className="mb-4 text-sm text-text-secondary">
                {isMongo
                  ? 'Accepted: .json, .csv, or a mongodump .zip.'
                  : 'Accepted: .csv (auto-creates a table) or a pg_dump .sql file.'}
              </p>
              <form onSubmit={onImport} className="space-y-3">
                {/* Drop zone */}
                <div className="border-2 border-dashed border-border rounded-lg p-7 text-center">
                  <Upload className="h-8 w-8 mx-auto text-text-muted mb-2.5" strokeWidth={1.5} />
                  <div className="text-base font-medium">Drag your file here</div>
                  <div className="text-sm text-text-secondary mt-1">
                    or <label className="text-accent underline cursor-pointer">
                      click to browse
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={isMongo ? '.json,.csv,.zip' : '.csv,.sql'}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <div className="text-xs text-text-muted mt-2">Max 500MB</div>
                </div>
                <input
                  ref={targetInputRef}
                  type="text"
                  placeholder="Target collection/table (optional, defaults to filename)"
                  className="block w-full rounded-md border border-border bg-bg-inset px-3 py-2 text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                {importError && <p className="text-sm text-danger">{importError}</p>}
                {importResult && (
                  <div className="rounded-md bg-success/10 border border-success/20 p-3 text-sm text-text-primary">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-success">✓</span>
                      <span className="font-medium">Imported {importResult.kind}</span>
                    </div>
                    <div className="text-xs text-text-secondary">
                      file: {importResult.file} → target: {importResult.target}
                      {importResult.count != null && <> · {importResult.count} rows</>}
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={importBusy}
                  className="w-full h-12 rounded bg-accent text-white text-[15px] font-medium inline-flex items-center justify-center gap-2 hover:bg-accent-hover disabled:opacity-50 transition-colors"
                >
                  <Upload className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  {importBusy ? 'Importing...' : 'Upload & import'}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'Settings' && (
          <div className="max-w-2xl space-y-6">
            {/* Connection details */}
            <div className="bg-[#111111] border border-border rounded-lg p-5">
              <div className="text-sm font-medium mb-4">Connection Details</div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-text-secondary">Host</dt><dd className="font-mono mt-1">{db.host}</dd></div>
                <div><dt className="text-text-secondary">Port</dt><dd className="font-mono mt-1">{db.port}</dd></div>
                <div><dt className="text-text-secondary">Username</dt><dd className="font-mono mt-1">{cred.username}</dd></div>
                <div><dt className="text-text-secondary">Status</dt><dd className="font-mono mt-1">{db.status}</dd></div>
              </dl>
            </div>

            {/* Danger zone */}
            <div className="border border-danger/30 bg-danger/5 rounded-lg p-5">
              <div className="text-sm font-medium text-danger mb-1">Danger zone</div>
              <p className="mb-3 text-sm text-danger/80">
                Deleting will stop the container, drop the data volume, and remove the metadata. This cannot be undone.
              </p>
              {confirmingDelete ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={onDelete}
                    disabled={deleteBusy}
                    className="h-9 px-3.5 rounded bg-danger text-white text-sm font-medium hover:bg-danger/80 disabled:opacity-50 transition-colors"
                  >
                    {deleteBusy ? 'Deleting...' : `Yes, delete ${db.name}`}
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="h-9 px-3.5 border border-border rounded text-sm text-text-secondary font-medium hover:bg-bg-inset transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="h-9 px-3.5 border border-danger/30 bg-bg-card rounded text-sm text-danger font-medium hover:bg-danger/10 transition-colors"
                >
                  Delete database
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
