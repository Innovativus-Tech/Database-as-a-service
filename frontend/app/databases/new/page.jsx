'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';

export default function NewDatabasePage() {
  const router = useRouter();
  const { loading: authLoading } = useRequireAuth();
  const [name, setName] = useState('');
  const [type, setType] = useState('nosql');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  if (authLoading) return <p className="text-slate-500">Loading...</p>;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.createDatabase(name, type);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-2xl font-semibold">Database created</h1>
        <p className="mb-6 text-slate-600">
          Save these credentials now — the password will be shown again on the database detail page,
          but you should treat the connection string as a secret.
        </p>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-700">Connection string</p>
          <code className="block break-all rounded bg-white p-3 font-mono text-sm">
            {result.connectionUrl}
          </code>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Username</dt>
            <dd className="font-mono">{result.credentials.username}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Password</dt>
            <dd className="font-mono">{result.credentials.password}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Host</dt>
            <dd className="font-mono">{result.database.host}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Port</dt>
            <dd className="font-mono">{result.database.port}</dd>
          </div>
        </dl>

        <div className="mt-8 flex gap-3">
          <Link
            href={`/databases/${result.database.id}`}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            Go to database
          </Link>
          <button
            onClick={() => router.push('/dashboard')}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">Create a database</h1>
      <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Database name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="myapp_prod"
            pattern="[a-zA-Z][a-zA-Z0-9_-]{2,39}"
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-500">3–40 chars, must start with a letter. Letters, numbers, _ and - only.</p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Engine</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'nosql', label: 'MongoDB', sub: 'NoSQL · document store' },
              { value: 'sql',   label: 'PostgreSQL', sub: 'SQL · relational' },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`cursor-pointer rounded-md border p-3 text-sm ${
                  type === opt.value ? 'border-slate-900 bg-slate-50' : 'border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={opt.value}
                  checked={type === opt.value}
                  onChange={() => setType(opt.value)}
                  className="sr-only"
                />
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-slate-500">{opt.sub}</div>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? 'Provisioning container...' : 'Create database'}
        </button>
        <p className="text-xs text-slate-500">
          The first MongoDB or Postgres create may take ~30 seconds while the Docker image is pulled.
        </p>
      </form>
    </div>
  );
}
