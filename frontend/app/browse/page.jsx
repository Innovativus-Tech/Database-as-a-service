'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import {
  Database, Leaf, Table2, ChevronDown, Search, RefreshCw,
  ChevronLeft, ChevronRight, Play, X, Code2, Trash2, Plus, FolderOpen,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import AppShell from '@/components/app/AppShell';
import Topbar from '@/components/app/Topbar';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';

function DbSelector({ databases, value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = databases.find((d) => d.id === value);
  const isMongo  = selected?.type === 'nosql';
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-2 rounded border border-border bg-bg-card px-3 py-2 text-left text-sm transition-colors hover:border-border-strong"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              {isMongo
                ? <Leaf className="h-4 w-4 flex-shrink-0 text-mongo" strokeWidth={1.75} />
                : <Database className="h-4 w-4 flex-shrink-0 text-postgres" strokeWidth={1.75} />}
              <span className="truncate font-medium">{selected.name}</span>
            </>
          ) : (
            <span className="text-text-muted">Select database…</span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-border bg-bg-card py-1 shadow-xl"
            >
              {databases.length === 0 ? (
                <li className="px-3 py-2 text-xs text-text-muted">No databases yet</li>
              ) : databases.map((d) => {
                const dIsMongo = d.type === 'nosql';
                const active = d.id === value;
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => { onChange(d.id); setOpen(false); }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        active ? 'bg-accent-dim text-text-primary' : 'text-text-secondary hover:bg-bg-row hover:text-text-primary'
                      )}
                    >
                      {dIsMongo
                        ? <Leaf className="h-4 w-4 text-mongo" strokeWidth={1.75} />
                        : <Database className="h-4 w-4 text-postgres" strokeWidth={1.75} />}
                      <span className="truncate">{d.name}</span>
                      <span className="ml-auto text-xs text-text-muted">{dIsMongo ? 'Mongo' : 'PG'}</span>
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function SchemaSelector({ schemas, primary, value, onChange, onDelete, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded border border-border bg-bg-card px-3 py-2 text-left text-sm transition-colors hover:border-border-strong"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FolderOpen className="h-4 w-4 flex-shrink-0 text-text-muted" strokeWidth={1.75} />
          <span className="truncate font-medium">{value || `Select ${label.toLowerCase()}…`}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-border bg-bg-card py-1 shadow-xl"
            >
              {schemas.length === 0 ? (
                <li className="px-3 py-2 text-xs text-text-muted">No {label.toLowerCase()}s yet</li>
              ) : schemas.map((s) => {
                const active = s === value;
                const isPrimary = s === primary;
                return (
                  <li key={s} className="group flex items-center">
                    <button
                      onClick={() => { onChange(s); setOpen(false); }}
                      className={cn(
                        'flex flex-1 items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                        active ? 'bg-accent-dim text-text-primary' : 'text-text-secondary hover:bg-bg-row hover:text-text-primary'
                      )}
                    >
                      <FolderOpen className="h-4 w-4 text-text-muted" strokeWidth={1.75} />
                      <span className="truncate">{s}</span>
                      {isPrimary && <span className="ml-auto text-[10px] text-text-muted">primary</span>}
                    </button>
                    {!isPrimary && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(s); }}
                        className="hidden p-1.5 text-text-muted hover:text-danger group-hover:block"
                        aria-label={`Drop ${s}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                  </li>
                );
              })}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function NewSchemaForm({ isMongo, label, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [firstCollection, setFirstCollection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onCreate(isMongo ? { name, firstCollection } : { name });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-2 space-y-2 rounded border border-border bg-bg-inset p-2.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`${label} name`}
        className="h-8 w-full rounded border border-border-strong bg-bg-card px-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
      />
      {isMongo && (
        <input
          value={firstCollection}
          onChange={(e) => setFirstCollection(e.target.value)}
          placeholder="First collection name"
          className="h-8 w-full rounded border border-border-strong bg-bg-card px-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
        />
      )}
      {isMongo && <p className="text-[11px] text-text-muted">Mongo needs at least one collection to create the database.</p>}
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex items-center gap-2 pt-0.5">
        <Button type="submit" size="sm" loading={busy} className="flex-1">Create</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function CollectionListItem({ name, count, active, onClick, onDelete }) {
  return (
    <div
      className={cn(
        'group flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors',
        active ? 'bg-accent-dim text-text-primary' : 'text-text-secondary hover:bg-bg-row hover:text-text-primary'
      )}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 truncate text-left">
        <Table2 className={cn('h-3.5 w-3.5 flex-shrink-0', active ? 'text-accent' : 'text-text-muted')} strokeWidth={1.75} />
        <span className="font-mono truncate">{name}</span>
      </button>
      <span className="text-xs text-text-muted group-hover:hidden">{typeof count === 'number' ? count.toLocaleString() : '—'}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="hidden p-0.5 text-text-muted hover:text-danger group-hover:block"
        aria-label={`Drop ${name}`}
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function NewCollectionForm({ isMongo, pgTypes, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [columns, setColumns] = useState(isMongo ? [] : [{ name: '', type: pgTypes?.[0] || 'text' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function updateColumn(i, key, value) {
    setColumns((c) => c.map((col, idx) => (idx === i ? { ...col, [key]: value } : col)));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onCreate(isMongo ? { name } : { name, columns });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-2 space-y-2 rounded border border-border bg-bg-inset p-2.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={isMongo ? 'Collection name' : 'Table name'}
        className="h-8 w-full rounded border border-border-strong bg-bg-card px-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
      />
      {!isMongo && (
        <div className="space-y-1.5">
          {columns.map((col, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={col.name}
                onChange={(e) => updateColumn(i, 'name', e.target.value)}
                placeholder="column"
                className="h-7 flex-1 rounded border border-border-strong bg-bg-card px-2 font-mono text-[11px] text-text-primary outline-none focus:border-accent"
              />
              <select
                value={col.type}
                onChange={(e) => updateColumn(i, 'type', e.target.value)}
                className="h-7 rounded border border-border-strong bg-bg-card px-1 font-mono text-[11px] text-text-primary"
              >
                {(pgTypes || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {columns.length > 1 && (
                <button type="button" onClick={() => setColumns((c) => c.filter((_, idx) => idx !== i))} className="p-1 text-text-muted hover:text-danger">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setColumns((c) => [...c, { name: '', type: pgTypes?.[0] || 'text' }])}
            className="text-[11px] text-accent hover:underline"
          >
            + Add column
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex items-center gap-2 pt-0.5">
        <Button type="submit" size="sm" loading={busy} className="flex-1">Create</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function PrettyJson({ value }) {
  let s;
  try { s = JSON.stringify(value, null, 2); } catch { s = String(value); }
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-bg-inset p-3 font-mono text-xs text-text-primary">
      {s}
    </pre>
  );
}

function MongoView({ rows, onSelect }) {
  if (!rows.length) return <EmptyState icon={Table2} title="No documents" description="This collection is empty." />;
  return (
    <ul className="space-y-2">
      {rows.map((doc, i) => (
        <motion.li
          key={doc._id || i}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, delay: Math.min(i, 10) * 0.02 }}
        >
          <button onClick={() => onSelect(doc)} className="block w-full text-left transition-colors hover:opacity-90">
            <PrettyJson value={doc} />
          </button>
        </motion.li>
      ))}
    </ul>
  );
}

function SqlView({ columns, rows, onSelect }) {
  if (!rows.length) return <EmptyState icon={Table2} title="No rows" description="This table is empty." />;
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-bg-inset text-xs uppercase tracking-wider text-text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c} className="sticky top-0 border-b border-border bg-bg-inset px-3 py-2 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} onClick={() => onSelect(r)} className="cursor-pointer border-b border-border/60 hover:bg-bg-row">
              {columns.map((c) => (
                <td key={c} className="max-w-xs truncate px-3 py-2 font-mono text-xs text-text-primary">
                  {r[c] === null || r[c] === undefined
                    ? <span className="text-text-muted">NULL</span>
                    : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocSlideOver({ db, collection, schema, isMongo, doc, onClose, onChanged }) {
  const [text, setText] = useState(() => isMongo ? JSON.stringify(doc, null, 2) : '');
  const [values, setValues] = useState(() => isMongo ? {} : { ...doc });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const docId = isMongo ? doc._id : doc.__ctid;
  const idLabel = isMongo ? String(doc._id) : `row ${doc.__ctid}`;

  async function onSave() {
    setError(null);
    setBusy(true);
    try {
      if (isMongo) {
        let parsed;
        try { parsed = JSON.parse(text); }
        catch { setError('Invalid JSON'); setBusy(false); return; }
        await api.updateDocument(db.id, collection, docId, parsed, schema);
      } else {
        const changed = {};
        for (const k of Object.keys(values)) {
          if (k === '__ctid') continue;
          if (values[k] !== doc[k]) changed[k] = values[k];
        }
        await api.updateDocument(db.id, collection, docId, { values: changed }, schema);
      }
      toast.success('Saved');
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await api.deleteDocument(db.id, collection, docId, schema);
      toast.success('Deleted');
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 380, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-shrink-0 flex-col overflow-hidden border-l border-border-strong bg-bg-card shadow-[-8px_0_24px_rgba(0,0,0,0.4)]"
    >
      <div className="flex h-13 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <span className="truncate font-mono text-sm text-accent">{idLabel}</span>
        <div className="flex items-center gap-2">
          <button onClick={onDelete} className="p-1 text-danger hover:opacity-80" aria-label="Delete">
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-bg-inset hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {isMongo ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            className="w-full resize-none rounded border border-border bg-bg-inset p-3 font-mono text-xs leading-[1.7] text-text-primary outline-none focus:border-accent"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {Object.keys(doc).filter((k) => k !== '__ctid').map((col) => (
              <div key={col}>
                <label className="mb-1 block text-[11px] text-text-muted">{col}</label>
                <input
                  value={values[col] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [col]: e.target.value }))}
                  className="h-9 w-full rounded border border-border-strong bg-bg-inset px-2.5 font-mono text-xs text-text-primary outline-none focus:border-accent"
                />
              </div>
            ))}
          </div>
        )}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </div>
      <div className="flex items-center gap-2.5 border-t border-border px-5 py-4">
        <Button className="flex-1" loading={busy} onClick={onSave}>Save Changes</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </motion.aside>
  );
}

function BrowsePageContent() {
  useRequireAuth();
  const searchParams = useSearchParams();
  const initialDbId = searchParams.get('db');
  const [selectedDbId, setSelectedDbId]  = useState(null);
  const [selectedColl, setSelectedColl]  = useState(null);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [filter, setFilter] = useState('');
  const [filterError, setFilterError] = useState(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [pendingFilter, setPendingFilter] = useState('');
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [creatingColl, setCreatingColl] = useState(false);
  const [selectedSchema, setSelectedSchema] = useState(null);
  const [creatingSchema, setCreatingSchema] = useState(false);

  const { data: dbList, isLoading: loadingDbs } = useQuery({
    queryKey: ['databases'],
    queryFn: () => api.listDatabases(),
  });
  const dbs = dbList?.databases ?? [];
  const selectedDb = dbs.find(d => d.id === selectedDbId);
  const isMongo = selectedDb?.type === 'nosql';
  const schemaLabel = isMongo ? 'Database' : 'Schema';

  // Auto-pick first DB once loaded
  useEffect(() => {
    if (selectedDbId || dbs.length === 0) return;
    const requested = initialDbId && dbs.some((db) => db.id === initialDbId) ? initialDbId : null;
    setSelectedDbId(requested || dbs[0].id);
  }, [dbs, initialDbId, selectedDbId]);

  // Reset selection when changing DBs
  useEffect(() => {
    setSelectedSchema(null);
    setSelectedColl(null);
    setSkip(0); setFilter(''); setPendingFilter(''); setFilterError(null);
  }, [selectedDbId]);

  const { data: schemasResp, isLoading: loadingSchemas, refetch: refetchSchemas } = useQuery({
    queryKey: ['schemas', selectedDbId],
    queryFn: () => api.listSchemas(selectedDbId),
    enabled: !!selectedDbId,
  });
  const schemas = schemasResp?.schemas ?? [];
  const primarySchema = schemasResp?.primary;

  // Auto-pick the primary schema once schemas load
  useEffect(() => {
    if (!selectedSchema && primarySchema) setSelectedSchema(primarySchema);
  }, [primarySchema, selectedSchema]);

  async function onCreateSchema(payload) {
    await api.createSchema(selectedDbId, payload);
    toast.success(`Created ${schemaLabel.toLowerCase()} "${payload.name}"`);
    setCreatingSchema(false);
    setSelectedSchema(payload.name);
    refetchSchemas();
  }

  async function onDropSchema(name) {
    if (!window.confirm(`Permanently drop "${name}" and everything inside it? This can't be undone.`)) return;
    try {
      await api.dropSchema(selectedDbId, name);
      toast.success(`Dropped "${name}"`);
      if (selectedSchema === name) setSelectedSchema(primarySchema);
      refetchSchemas();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Reset collection selection when switching schemas
  useEffect(() => {
    setSelectedColl(null);
    setSkip(0); setFilter(''); setPendingFilter(''); setFilterError(null);
  }, [selectedSchema]);

  const { data: collsResp, isLoading: loadingColls, refetch: refetchColls } = useQuery({
    queryKey: ['collections', selectedDbId, selectedSchema],
    queryFn: () => api.listCollections(selectedDbId, selectedSchema),
    enabled: !!selectedDbId && !!selectedSchema,
  });
  const collections = collsResp?.collections ?? [];

  const { data: columnTypesResp } = useQuery({
    queryKey: ['columnTypes'],
    queryFn: () => api.getColumnTypes(),
    enabled: !isMongo,
    staleTime: Infinity,
  });
  const pgTypes = columnTypesResp?.types ?? [];

  async function onCreateCollection(payload) {
    await api.createCollection(selectedDbId, { ...payload, schema: selectedSchema });
    toast.success(`Created ${isMongo ? 'collection' : 'table'} "${payload.name}"`);
    setCreatingColl(false);
    setSelectedColl(payload.name);
    refetchColls();
  }

  async function onDropCollection(name) {
    if (!window.confirm(`Permanently drop "${name}" and all its data? This can't be undone.`)) return;
    try {
      await api.dropCollection(selectedDbId, name, selectedSchema);
      toast.success(`Dropped "${name}"`);
      if (selectedColl === name) setSelectedColl(null);
      refetchColls();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Auto-pick first collection when collections load
  useEffect(() => {
    if (!selectedColl && collections.length > 0) setSelectedColl(collections[0].name);
  }, [collections, selectedColl]);

  // Validate filter JSON for mongo
  const validatedFilter = useMemo(() => {
    if (!isMongo || !filter.trim()) return undefined;
    try { JSON.parse(filter); return filter; }
    catch { return null; }
  }, [filter, isMongo]);

  const { data: browseData, isFetching: loadingData, error: browseError, refetch: refetchData } = useQuery({
    queryKey: ['browse', selectedDbId, selectedSchema, selectedColl, skip, limit, validatedFilter],
    queryFn: () => api.browseCollection(selectedDbId, selectedColl, {
      skip, limit, filter: validatedFilter, schema: selectedSchema,
    }),
    enabled: !!(selectedDbId && selectedSchema && selectedColl) && validatedFilter !== null,
  });

  function applyFilter() {
    setFilterError(null);
    if (isMongo && pendingFilter.trim()) {
      try { JSON.parse(pendingFilter); }
      catch { setFilterError('Filter must be valid JSON'); return; }
    }
    setFilter(pendingFilter);
    setSkip(0);
  }

  function onCollectionChange(name) {
    setSelectedColl(name);
    setSkip(0); setFilter(''); setPendingFilter('');
  }

  const total = browseData?.total ?? 0;
  const start = browseData?.skip ?? skip;
  const showing = browseData ? `${start + 1}–${Math.min(start + browseData.rows.length, total)} of ${total}` : '';
  const canPrev = skip > 0;
  const canNext = browseData && skip + browseData.rows.length < total;

  return (
    <AppShell>
      <Topbar
        title="Browse Data"
        subtitle={selectedDb ? `${selectedDb.name} / ${selectedSchema || '…'} · ${selectedColl || 'no selection'}` : 'Pick a database to start'}
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setSelectedDoc(null); setConsoleOpen(v => !v); }}
            leftIcon={<Code2 className="h-4 w-4" />}
          >
            {consoleOpen ? 'Hide console' : 'Query console'}
          </Button>
        }
      />

      <main className="flex h-[calc(100vh-52px)] overflow-hidden">
        {/* Panel 1: DB + collections */}
        <aside className="flex w-60 flex-shrink-0 flex-col border-r border-border bg-bg-base">
          <div className="border-b border-border p-3">
            {loadingDbs
              ? <Skeleton className="h-9" />
              : <DbSelector databases={dbs} value={selectedDbId} onChange={setSelectedDbId} />
            }
          </div>
          <div className="border-b border-border p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">{schemaLabel}</span>
              <button
                onClick={() => setCreatingSchema((v) => !v)}
                disabled={!selectedDb}
                className="rounded p-1 text-text-secondary hover:bg-bg-inset hover:text-text-primary disabled:opacity-40"
                aria-label={`New ${schemaLabel.toLowerCase()}`}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
            {creatingSchema && (
              <NewSchemaForm
                isMongo={isMongo}
                label={schemaLabel}
                onCreate={onCreateSchema}
                onCancel={() => setCreatingSchema(false)}
              />
            )}
            {loadingSchemas
              ? <Skeleton className="h-9" />
              : (
                <SchemaSelector
                  schemas={schemas}
                  primary={primarySchema}
                  value={selectedSchema}
                  onChange={setSelectedSchema}
                  onDelete={onDropSchema}
                  label={schemaLabel}
                />
              )
            }
          </div>
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
              {isMongo ? 'Collections' : 'Tables'}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCreatingColl((v) => !v)}
                disabled={!selectedDb}
                className="rounded p-1 text-text-secondary hover:bg-bg-inset hover:text-text-primary disabled:opacity-40"
                aria-label={isMongo ? 'New collection' : 'New table'}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                onClick={() => refetchColls()}
                className="rounded p-1 text-text-secondary hover:bg-bg-inset hover:text-text-primary"
                aria-label="Refresh"
              >
                <RefreshCw className={cn('h-3 w-3', loadingColls && 'animate-spin')} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {creatingColl && (
              <NewCollectionForm
                isMongo={isMongo}
                pgTypes={pgTypes}
                onCreate={onCreateCollection}
                onCancel={() => setCreatingColl(false)}
              />
            )}
            {loadingColls ? (
              <div className="space-y-1 p-1">
                {[0,1,2].map(i => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : collections.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-text-muted">
                {selectedDb ? `No ${isMongo ? 'collections' : 'tables'} yet.` : 'Select a database.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {collections.map((c) => (
                  <li key={c.name}>
                    <CollectionListItem
                      name={c.name}
                      count={c.count}
                      active={c.name === selectedColl}
                      onClick={() => onCollectionChange(c.name)}
                      onDelete={() => onDropCollection(c.name)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Panel 2: content */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
            <div className="flex flex-1 items-center gap-2">
              {isMongo ? (
                <div className="flex flex-1 items-center gap-2 rounded border border-border bg-bg-inset px-3 py-1.5 focus-within:border-accent">
                  <Search className="h-4 w-4 text-text-muted" />
                  <input
                    type="text"
                    value={pendingFilter}
                    onChange={(e) => setPendingFilter(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
                    placeholder='e.g. {"age": {"$gt": 25}}'
                    className="w-full bg-transparent font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                  />
                </div>
              ) : (
                <div className="flex flex-1 items-center gap-2 rounded border border-border bg-bg-inset px-3 py-1.5">
                  <Search className="h-4 w-4 text-text-muted" />
                  <span className="text-xs text-text-muted">Filtering not supported for tables in this view — use the Query Console.</span>
                </div>
              )}
              <Button size="sm" onClick={applyFilter} leftIcon={<Play className="h-3.5 w-3.5" />}>
                Run
              </Button>
              <Button size="sm" variant="ghost" onClick={() => refetchData()} leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', loadingData && 'animate-spin')} />}>
                Refresh
              </Button>
            </div>
          </div>
          {filterError && <p className="border-b border-danger/30 bg-danger/10 px-6 py-2 text-xs text-danger">{filterError}</p>}

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!selectedColl ? (
              <EmptyState icon={Table2} title="Select a collection" description="Pick something from the left sidebar to start browsing." />
            ) : loadingData && !browseData ? (
              <div className="space-y-2">
                {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : browseError ? (
              <p className="text-sm text-danger">{browseError.message}</p>
            ) : browseData?.type === 'sql' ? (
              <SqlView
                columns={browseData.columns}
                rows={browseData.rows}
                onSelect={(row) => { setConsoleOpen(false); setSelectedDoc(row); }}
              />
            ) : (
              <MongoView
                rows={browseData?.rows ?? []}
                onSelect={(doc) => { setConsoleOpen(false); setSelectedDoc(doc); }}
              />
            )}
          </div>

          {/* Pagination */}
          {browseData && browseData.rows && (
            <div className="flex items-center justify-between border-t border-border px-6 py-2 text-xs text-text-secondary">
              <div className="flex items-center gap-3">
                <span className="text-text-muted">{showing}</span>
                <select
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setSkip(0); }}
                  className="rounded border border-border bg-bg-inset px-2 py-1 text-xs text-text-primary"
                >
                  {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={!canPrev} onClick={() => setSkip(Math.max(0, skip - limit))} leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}>Prev</Button>
                <Button size="sm" variant="ghost" disabled={!canNext} onClick={() => setSkip(skip + limit)} rightIcon={<ChevronRight className="h-3.5 w-3.5" />}>Next</Button>
              </div>
            </div>
          )}
        </section>

        {/* Panel 3: document edit slide-over, or Query Console — mutually exclusive */}
        <AnimatePresence>
          {selectedDoc && (
            <DocSlideOver
              key="doc-slideover"
              db={selectedDb}
              collection={selectedColl}
              schema={selectedSchema}
              isMongo={isMongo}
              doc={selectedDoc}
              onClose={() => setSelectedDoc(null)}
              onChanged={() => refetchData()}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {consoleOpen && !selectedDoc && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-shrink-0 flex-col overflow-hidden border-l border-border bg-bg-sidebar"
            >
              <div className="flex h-13 flex-shrink-0 items-center justify-between border-b border-border px-4">
                <div>
                  <div className="text-sm font-medium">Query Console</div>
                  <div className="text-xs text-text-muted">
                    {isMongo ? 'Mongo filter (JSON)' : 'Filter not yet supported for SQL'}
                  </div>
                </div>
                <button
                  onClick={() => setConsoleOpen(false)}
                  className="rounded p-1 text-text-secondary hover:bg-bg-inset hover:text-text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <textarea
                  value={pendingFilter}
                  onChange={(e) => setPendingFilter(e.target.value)}
                  placeholder={isMongo
                    ? '{\n  "age": { "$gt": 25 },\n  "city": "Tokyo"\n}'
                    : '-- Postgres filtering coming next'}
                  disabled={!isMongo}
                  rows={10}
                  className="w-full rounded border border-border bg-bg-inset p-3 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50"
                />
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" onClick={applyFilter} leftIcon={<Play className="h-3.5 w-3.5" />} disabled={!isMongo}>Run query</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPendingFilter(''); setFilter(''); }}>Clear</Button>
                </div>
                <p className="mt-4 text-xs text-text-muted">
                  Press <kbd className="rounded border border-border bg-bg-inset px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> in the toolbar to run too.
                </p>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </main>
    </AppShell>
  );
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<AppShell><Topbar title="Browse Data" subtitle="Loading..." /></AppShell>}>
      <BrowsePageContent />
    </Suspense>
  );
}
