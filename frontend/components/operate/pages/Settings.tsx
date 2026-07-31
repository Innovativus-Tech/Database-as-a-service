import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate } from '../lib/utils'
import { useAuthStore, type AuthUser } from '../stores/connections.store'

interface AuditEvent { id: string; actor: string; action: string; target: string; timestamp: string }
interface TeamMember {
  id: string; email: string; fullName?: string | null
  profileRole: string; createdAt: string; lastLoginAt?: string | null
}

/**
 * Hydrate the console's session from the CustomDB account the user is already
 * signed in as. There is no separate login here — /api/auth/me is the same
 * endpoint the surrounding dashboard uses.
 */
function useCurrentUser() {
  const { user, setUser } = useAuthStore()
  const { data } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<{ user: AuthUser }>('/api/auth/me'),
    staleTime: 60_000,
  })
  useEffect(() => {
    if (data?.user) setUser(data.user)
  }, [data, setUser])
  return data?.user ?? user
}

export function SettingsPage() {
  const [tab, setTab] = useState<'users' | 'audit'>('users')
  useCurrentUser()

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="flex gap-1 border-b border-border mb-6">
        {(['users', 'audit'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize ${tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t === 'users' ? 'My Workspace' : 'Audit Log'}
          </button>
        ))}
      </div>
      {tab === 'users' ? <TeamTab /> : <AuditTab />}
    </div>
  )
}

// ── Team: read-only members of your own workspace ─────────────────────────────
//
// Scoping is implicit — the backend always resolves the caller's own
// workspace — so there is no profile id to pass around and no cross-tenant
// access to guard against here.

function TeamTab() {
  const qc = useQueryClient()

  const { data: team = [] } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<TeamMember[]>('/api/connections/team'),
  })

  // The workspace owner manages members; invited viewers only see the list.
  const viewers = team.filter((m) => m.profileRole === 'viewer')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const inviteMutation = useMutation({
    mutationFn: () => api.post('/api/connections/team', { email, password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team'] })
      setEmail(''); setPassword('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/connections/team/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })

  return (
    <div className="space-y-6">
      {/* Invite viewer form */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="font-semibold mb-1">Invite Viewer</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Viewers can read all data in your workspace but cannot create, edit, or delete anything.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="viewer@company.com"
              className="w-full bg-input border border-border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-input border border-border rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <button
          onClick={() => inviteMutation.mutate()}
          disabled={!email || !password || inviteMutation.isPending}
          className="mt-4 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm rounded hover:bg-primary/90 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          {inviteMutation.isPending ? 'Adding…' : 'Add Viewer'}
        </button>
        {inviteMutation.isError && (
          <p className="text-xs text-destructive mt-2">{(inviteMutation.error as Error).message}</p>
        )}
        {inviteMutation.isSuccess && (
          <p className="text-xs text-green-500 mt-2">Viewer added — share their email and password with them.</p>
        )}
      </div>

      {/* Viewers table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-semibold">Viewers in your workspace ({viewers.length})</h2>
        </div>
        {viewers.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No viewers yet. Add one above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase bg-secondary/20">
                <th className="text-left px-4 py-2">Email</th>
                <th className="text-left px-4 py-2">Added</th>
                <th className="text-left px-4 py-2">Last Login</th>
                <th className="text-right px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {viewers.map((v) => (
                <tr key={v.id} className="border-b border-border/30 hover:bg-secondary/10">
                  <td className="px-4 py-2">{v.email}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(v.createdAt)}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {v.lastLoginAt ? formatDate(v.lastLoginAt) : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => removeMutation.mutate(v.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Audit log (shared) ────────────────────────────────────────────────────────

function AuditTab() {
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')

  const { data } = useQuery({
    queryKey: ['audit', page, actionFilter],
    queryFn: () => api.get<{ events: AuditEvent[]; total: number }>(
      `/api/settings/audit?page=${page}&pageSize=50${actionFilter ? `&action=${actionFilter}` : ''}`
    ),
  })

  const events = data?.events ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 50)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
          className="bg-input border border-border rounded px-3 py-2 text-sm">
          <option value="">All actions</option>
          <option value="kill_op">kill_op</option>
          <option value="delete_connection">delete_connection</option>
          <option value="sync_replace">sync_replace</option>
          <option value="restore_backup">restore_backup</option>
          <option value="delete_backup">delete_backup</option>
          <option value="create_migration">create_migration</option>
        </select>
        <span className="text-sm text-muted-foreground">{total.toLocaleString()} events</span>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase bg-secondary/20">
              <th className="text-left px-4 py-2">Time</th>
              <th className="text-left px-4 py-2">Actor</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">Target</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border/30 hover:bg-secondary/10">
                <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(e.timestamp)}</td>
                <td className="px-4 py-2 text-xs">{e.actor}</td>
                <td className="px-4 py-2">
                  <span className="bg-secondary text-xs px-1.5 py-0.5 rounded font-mono">{e.action}</span>
                </td>
                <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{e.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}
            className="text-xs px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-secondary">
            Previous
          </button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="text-xs px-3 py-1 rounded border border-border disabled:opacity-40 hover:bg-secondary">
            Next
          </button>
        </div>
      )}
    </div>
  )
}
