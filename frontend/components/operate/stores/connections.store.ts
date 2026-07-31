import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ConnectionsStore {
  activeConnectionId: string | null
  setActiveConnection: (id: string | null) => void
}

export const useConnectionsStore = create<ConnectionsStore>()(
  persist(
    (set) => ({
      activeConnectionId: null,
      setActiveConnection: (id) => set({ activeConnectionId: id }),
    }),
    { name: 'connections-store' },
  ),
)

// Session state for the console.
//
// Upstream this was written to by PivotDB's own login page. In the merged
// product authentication belongs to CustomDB, so there is nothing to write
// here — the store instead reads the session the dashboard already
// established. `useCurrentUser` hydrates it from /api/auth/me on mount.
export interface AuthUser {
  id: string
  email: string
  /** Platform-wide role: 'user' | 'admin'. */
  role: string
  /** Workspace-level role: 'admin' | 'viewer'. */
  profileRole?: string
  profileId: string | null
}

interface AuthStore {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
}

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}))
