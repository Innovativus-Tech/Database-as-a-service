'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

function PrettyJson({ value }) {
  let s;
  try { s = JSON.stringify(value, null, 2); } catch { s = String(value); }
  return <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono text-xs">{s}</pre>;
}

function PostgresTable({ columns, rows }) {
  return (
    <div className="overflow-auto rounded border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-200">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 font-mono text-xs">
                  {r[c] === null || r[c] === undefined ? <span className="text-slate-400">NULL</span> : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">No rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MongoDocs({ rows }) {
  if (rows.length === 0) return <p className="text-center text-sm text-slate-500">No documents</p>;
  return (
    <ul className="space-y-2">
      {rows.map((doc, i) => (
        <li key={doc._id || i}>
          <PrettyJson value={doc} />
        </li>
      ))}
    </ul>
  );
}

export default function DataBrowser({ databaseId, dbType }) {
  const [collections, setCollections] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [skip, setSkip] = useState(0);
  const [limit] = useState(25);
  const [filter, setFilter] = useState('');
  const [filterError, setFilterError] = useState(null);

  const isMongo = dbType === 'nosql';
  const label = isMongo ? 'Collection' : 'Table';

  const refreshCollections = useCallback(async () => {
    setError(null);
    try {
      const r = await api.listCollections(databaseId);
      setCollections(r.collections);
      if (!selected && r.collections.length > 0) setSelected(r.collections[0].name);
    } catch (err) {
      setError(err.message);
    }
  }, [databaseId, selected]);

  useEffect(() => { refreshCollections(); }, [refreshCollections]);

  const loadData = useCallback(async () => {
    if (!selected) return;
    setLoadingData(true);
    setFilterError(null);
    try {
      let opts = { skip, limit };
      if (isMongo && filter.trim()) {
        try { JSON.parse(filter); opts.filter = filter; }
        catch (e) { setFilterError('Filter must be valid JSON'); setLoadingData(false); return; }
      }
      const r = await api.browseCollection(databaseId, selected, opts);
      setData(r);
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoadingData(false);
    }
  }, [databaseId, selected, skip, limit, filter, isMongo]);

  useEffect(() => { loadData(); }, [loadData]);

  function onCollectionChange(name) {
    setSelected(name);
    setSkip(0);
    setFilter('');
    setData(null);
  }

  if (error && !collections) return <p className="text-sm text-red-600">{error}</p>;
  if (!collections) return <p className="text-sm text-slate-500">Loading collections...</p>;

  if (collections.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No {isMongo ? 'collections' : 'tables'} yet — import a file above to create some data.
      </p>
    );
  }

  const total = data?.total ?? 0;
  const showing = data ? `${data.skip + 1}–${Math.min(data.skip + data.rows.length, total)} of ${total}` : '';
  const canPrev = skip > 0;
  const canNext = data && skip + data.rows.length < total;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</label>
          <select
            value={selected || ''}
            onChange={(e) => onCollectionChange(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
          >
            {collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}{typeof c.count === 'number' ? ` (${c.count})` : ''}
              </option>
            ))}
          </select>
        </div>

        {isMongo && (
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
              Filter (JSON, optional)
            </label>
            <input
              type="text"
              value={filter}
              placeholder='e.g. {"age": {"$gt": 25}}'
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </div>
        )}

        <button
          onClick={() => { setSkip(0); loadData(); }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100"
        >
          Run
        </button>
      </div>

      {filterError && <p className="text-sm text-red-600">{filterError}</p>}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        {loadingData && <p className="text-sm text-slate-500">Loading...</p>}
        {!loadingData && data && (
          <>
            {data.type === 'sql'
              ? <PostgresTable columns={data.columns} rows={data.rows} />
              : <MongoDocs rows={data.rows} />
            }
            <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
              <span>{showing}</span>
              <div className="flex gap-2">
                <button
                  disabled={!canPrev}
                  onClick={() => setSkip(Math.max(0, skip - limit))}
                  className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                >Prev</button>
                <button
                  disabled={!canNext}
                  onClick={() => setSkip(skip + limit)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                >Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
