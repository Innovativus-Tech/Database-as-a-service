'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  FileJson, FileText, Archive, FileCode2, Upload, ArrowRight, Check, Database, Leaf, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

const SOURCES = [
  { id: 'json', label: 'JSON File',  icon: FileJson,  desc: 'Upload an array of JSON documents',  exts: '.json',   dbTypes: ['nosql'] },
  { id: 'csv',  label: 'CSV File',   icon: FileText,  desc: 'Each row becomes a doc / table row', exts: '.csv',    dbTypes: ['nosql', 'sql'] },
  { id: 'zip',  label: 'mongodump',  icon: Archive,   desc: 'Restore a mongodump archive',         exts: '.zip',    dbTypes: ['nosql'] },
  { id: 'sql',  label: 'pg_dump',    icon: FileCode2, desc: 'Run a Postgres SQL dump',             exts: '.sql',    dbTypes: ['sql'] },
];

const STEPS = [
  { n: 1, label: 'Source' },
  { n: 2, label: 'Configure' },
  { n: 3, label: 'Review' },
  { n: 4, label: 'Import' },
];

function StepIndicator({ current }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const done = current > s.n;
        const active = current === s.n;
        return (
          <li key={s.n} className="flex items-center gap-2">
            <div className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors',
              done   && 'bg-accent text-white',
              active && 'bg-accent-dim text-accent ring-1 ring-inset ring-accent',
              !done && !active && 'bg-bg-inset text-text-muted'
            )}>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : s.n}
            </div>
            <span className={cn('text-xs font-medium', active || done ? 'text-text-primary' : 'text-text-muted')}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={cn('mx-2 h-px w-6', done ? 'bg-accent' : 'bg-border')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SourceCard({ source, selected, onClick }) {
  const Icon = source.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-3 rounded-lg border bg-bg-card p-5 text-left transition-all duration-150',
        selected
          ? 'border-accent ring-1 ring-accent/40 bg-accent-dim'
          : 'border-border hover:border-border-strong hover:bg-bg-row'
      )}
    >
      <div className={cn('rounded-md p-2', selected ? 'bg-accent/20 text-accent' : 'bg-bg-inset text-text-secondary')}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div>
        <div className="text-sm font-medium">{source.label}</div>
        <div className="mt-0.5 text-xs text-text-secondary">{source.desc}</div>
      </div>
      <span className="text-xs text-text-muted">Accepts {source.exts}</span>
    </button>
  );
}

function ProgressRing({ percent }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const indeterminate = percent == null;
  // Clamp — the backend's CSV row total is an estimate, so processed can
  // slightly overshoot it near the end.
  const clamped = indeterminate ? null : Math.max(0, Math.min(100, percent));
  const dashoffset = indeterminate ? circumference * 0.7 : circumference * (1 - clamped / 100);
  return (
    <svg
      width="80" height="80" viewBox="0 0 80 80"
      style={{ transform: 'rotate(-90deg)' }}
      className={indeterminate ? 'animate-spin' : ''}
    >
      <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <circle
        cx="40" cy="40" r={r} fill="none" stroke="#5B6AF0" strokeWidth="6" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={dashoffset}
      />
    </svg>
  );
}

function DropZone({ accept, file, onFile, onRemove }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  function onSelect(f) {
    if (!f) return;
    onFile(f);
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onSelect(f);
      }}
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 transition-all',
        drag
          ? 'border-accent bg-accent-dim'
          : file ? 'border-border bg-bg-card' : 'border-border bg-bg-card hover:border-border-strong'
      )}
    >
      {file ? (
        <div className="flex w-full items-center justify-between rounded border border-border bg-bg-inset px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{file.name}</div>
            <div className="text-xs text-text-muted">{(file.size / 1024).toFixed(1)} KB</div>
          </div>
          <button
            onClick={onRemove}
            className="rounded p-1.5 text-text-secondary hover:bg-bg-card hover:text-danger"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <Upload className="mb-3 h-6 w-6 text-text-muted" strokeWidth={1.5} />
          <p className="text-sm text-text-primary">Drag &amp; drop a file here</p>
          <p className="mt-1 text-xs text-text-muted">or click to browse</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => ref.current?.click()}
          >
            Choose file
          </Button>
          <input
            ref={ref}
            type="file"
            accept={accept}
            hidden
            onChange={(e) => onSelect(e.target.files?.[0])}
          />
        </>
      )}
    </div>
  );
}

export default function ImportPage() {
  useRequireAuth();
  const [step, setStep]           = useState(1);
  const [sourceId, setSourceId]   = useState(null);
  const [databaseId, setDbId]     = useState(null);
  const [target, setTarget]       = useState('');
  const [file, setFile]           = useState(null);
  const [busy, setBusy]           = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);
  const [jobStatus, setJobStatus] = useState(null); // { status, processed, total, elapsedMs }
  const pollRef = useRef(null);

  const { data: dbList, isLoading: loadingDbs } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
  });
  const dbs = dbList?.databases ?? [];

  const source = useMemo(() => SOURCES.find(s => s.id === sourceId), [sourceId]);
  const eligibleDbs = useMemo(() => {
    if (!source) return [];
    return dbs.filter(d => source.dbTypes.includes(d.type));
  }, [source, dbs]);

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep(1); setSourceId(null); setDbId(null); setTarget(''); setFile(null);
    setResult(null); setError(null); setJobStatus(null); setBusy(false);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function onImport() {
    if (!databaseId || !file) return;
    setBusy(true); setError(null); setJobStatus(null);
    setStep(4);
    try {
      const { jobId } = await api.importFile(databaseId, file, target || undefined);
      // Tolerate transient poll failures — while the backend is busy inserting
      // a large file, an occasional request can time out or blip. Only give up
      // on a real auth failure, a lost job, or many consecutive misses.
      let consecutiveFailures = 0;
      const MAX_CONSECUTIVE_FAILURES = 10;
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getImportJobStatus(databaseId, jobId);
          consecutiveFailures = 0;
          setJobStatus(status);
          if (status.status === 'done') {
            clearInterval(pollRef.current);
            setResult(status.result);
            setBusy(false);
            toast.success('Import complete');
          } else if (status.status === 'error') {
            clearInterval(pollRef.current);
            setError(status.error);
            setBusy(false);
            toast.error(status.error);
          }
        } catch (err) {
          if (err?.status === 401) {
            clearInterval(pollRef.current);
            setError('Your session expired. Log in again — the import may still be running on the server.');
            setBusy(false);
            return;
          }
          if (err?.status === 404) {
            clearInterval(pollRef.current);
            setError('Lost track of the import job (the server may have restarted). Check the database to see whether the data arrived.');
            setBusy(false);
            return;
          }
          consecutiveFailures += 1;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            clearInterval(pollRef.current);
            setError('Can’t reach the server to check import progress. The import may still be running — check the database in a minute.');
            setBusy(false);
          }
        }
      }, 1000);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <Topbar title="Import Data" subtitle="Bring data in from a file or existing dump" />
      <main className="px-8 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex justify-center">
            <StepIndicator current={step} />
          </div>

          <AnimatePresence mode="wait">
            {/* STEP 1 — source */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-lg font-medium tracking-tight">Choose a source</h2>
                <p className="mt-1 text-sm text-text-secondary">Pick the type of file you want to import.</p>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {SOURCES.map((s) => (
                    <SourceCard
                      key={s.id}
                      source={s}
                      selected={sourceId === s.id}
                      onClick={() => setSourceId(s.id)}
                    />
                  ))}
                </div>
                <div className="mt-6 flex justify-end">
                  <Button
                    disabled={!sourceId}
                    onClick={() => setStep(2)}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    Continue
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP 2 — configure */}
            {step === 2 && source && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-lg font-medium tracking-tight">Configure import</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Source: <span className="text-text-primary">{source.label}</span>
                </p>

                <div className="mt-5 space-y-4">
                  {/* Database picker */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">Target database</label>
                    {loadingDbs ? (
                      <Skeleton className="h-10" />
                    ) : eligibleDbs.length === 0 ? (
                      <Card variant="inset" className="flex items-center justify-between p-4">
                        <p className="text-sm text-text-secondary">
                          No {source.dbTypes.includes('nosql') ? 'MongoDB' : 'PostgreSQL'} databases available.
                        </p>
                        <Link href="/databases/new"><Button size="sm">Create one</Button></Link>
                      </Card>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {eligibleDbs.map((d) => {
                          const sel = d.id === databaseId;
                          const Icon = d.type === 'nosql' ? Leaf : Database;
                          const color = d.type === 'nosql' ? 'text-mongo' : 'text-postgres';
                          return (
                            <button
                              key={d.id}
                              onClick={() => setDbId(d.id)}
                              className={cn(
                                'flex items-center gap-3 rounded border p-3 text-left transition-all',
                                sel ? 'border-accent bg-accent-dim' : 'border-border bg-bg-card hover:bg-bg-row'
                              )}
                            >
                              <Icon className={cn('h-4 w-4', color)} strokeWidth={1.75} />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{d.name}</div>
                                <div className="text-xs text-text-muted">{d.host}:{d.port}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Target collection / table (only for JSON / CSV) */}
                  {(sourceId === 'json' || sourceId === 'csv') && (
                    <Input
                      label={source.dbTypes.includes('sql') && databaseId && dbs.find(d => d.id === databaseId)?.type === 'sql'
                        ? 'Target table (optional)'
                        : 'Target collection (optional)'}
                      placeholder="defaults to the filename"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      helper="Letters, numbers, underscores. 3–63 chars."
                    />
                  )}

                  {/* File drop zone */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-text-secondary">File</label>
                    <DropZone accept={source.exts} file={file} onFile={setFile} onRemove={() => setFile(null)} />
                  </div>
                </div>

                <div className="mt-6 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                  <Button
                    disabled={!databaseId || !file}
                    onClick={() => setStep(3)}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                  >
                    Review
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP 3 — review */}
            {step === 3 && source && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-lg font-medium tracking-tight">Review &amp; confirm</h2>
                <p className="mt-1 text-sm text-text-secondary">Double-check before kicking off the import.</p>

                <Card className="mt-5">
                  <dl className="grid grid-cols-2 divide-x divide-y divide-border">
                    <div className="p-4">
                      <dt className="text-xs uppercase tracking-wider text-text-muted">Source</dt>
                      <dd className="mt-1 text-sm">{source.label}</dd>
                    </div>
                    <div className="p-4">
                      <dt className="text-xs uppercase tracking-wider text-text-muted">Database</dt>
                      <dd className="mt-1 font-mono text-sm">{dbs.find(d => d.id === databaseId)?.name}</dd>
                    </div>
                    <div className="p-4">
                      <dt className="text-xs uppercase tracking-wider text-text-muted">Target</dt>
                      <dd className="mt-1 font-mono text-sm">{target || <span className="text-text-muted">from filename</span>}</dd>
                    </div>
                    <div className="p-4">
                      <dt className="text-xs uppercase tracking-wider text-text-muted">File</dt>
                      <dd className="mt-1 text-sm">
                        <span className="font-mono">{file?.name}</span>
                        <span className="ml-2 text-text-muted">({(file?.size / 1024).toFixed(1)} KB)</span>
                      </dd>
                    </div>
                  </dl>
                </Card>

                {error && <p className="mt-3 text-sm text-danger">{error}</p>}

                <div className="mt-6 flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>Back</Button>
                  <Button
                    onClick={onImport}
                    loading={busy}
                    leftIcon={busy ? null : <Upload className="h-4 w-4" />}
                  >
                    {busy ? 'Importing...' : 'Start import'}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* STEP 4 — in progress / done / error */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {busy ? (
                  <Card className="flex flex-col items-center p-8">
                    <ProgressRing percent={jobStatus?.total ? (jobStatus.processed / jobStatus.total) * 100 : null} />
                    <h2 className="mt-5 text-lg font-medium">Importing…</h2>
                    {jobStatus?.total ? (
                      <>
                        <p className="mt-1.5 text-sm text-text-secondary">
                          {jobStatus.processed.toLocaleString()} / {jobStatus.total.toLocaleString()} documents
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {jobStatus.elapsedMs > 0
                            ? `~${Math.round((jobStatus.processed / jobStatus.elapsedMs) * 1000)} docs/sec`
                            : ''}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1.5 text-sm text-text-secondary">
                        Running {source?.label.toLowerCase()} restore — this can take a while for large dumps.
                      </p>
                    )}
                  </Card>
                ) : error ? (
                  <Card className="p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/15 text-danger">
                      <X className="h-6 w-6" strokeWidth={2} />
                    </div>
                    <h2 className="text-lg font-medium">Import failed</h2>
                    <p className="mt-1 text-sm text-danger">{error}</p>
                    <div className="mt-6 flex gap-2">
                      <Button variant="ghost" onClick={() => setStep(3)}>Back</Button>
                      <Button onClick={reset}>Start over</Button>
                    </div>
                  </Card>
                ) : result ? (
                  <Card className="p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
                      <Check className="h-6 w-6" strokeWidth={2} />
                    </div>
                    <h2 className="text-lg font-medium">Import complete</h2>
                    <p className="mt-1 text-sm text-text-secondary">
                      {result.kind}
                      {result.target && ` → ${result.target}`}
                      {typeof result.count === 'number' && ` · ${result.count.toLocaleString()} rows`}
                    </p>

                    {result.log && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">View log</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-inset p-3 font-mono text-xs">{result.log}</pre>
                      </details>
                    )}

                    <div className="mt-6 flex gap-2">
                      <Link href={`/browse?db=${encodeURIComponent(databaseId)}`}>
                        <Button variant="ghost">Browse data</Button>
                      </Link>
                      <Button onClick={reset}>Import another</Button>
                    </div>
                  </Card>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </AppShell>
  );
}
