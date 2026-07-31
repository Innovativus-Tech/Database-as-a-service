'use client'

// The PivotDB console, mounted inside the CustomDB dashboard.
//
// These pages are a self-contained React Router SPA. Rather than rewrite ~5,000
// lines of working page code into App Router conventions, the whole SPA is
// mounted under the `/operate` basename by app/operate/[[...slug]]/page.jsx.
// Deep links (/operate/migrate, /operate/protect, …) work, browser
// back/forward works, and the pages themselves are untouched.
//
// Two things differ from the standalone PivotDB app:
//
//   1. No /login or /signup routes. Authentication belongs to CustomDB — this
//      subtree only ever renders for an already-signed-in user, and the
//      dashboard's own guard redirects anyone else.
//   2. No <Layout> wrapper. The CustomDB shell (sidebar + topbar) already
//      surrounds this subtree, so PivotDB's own chrome would double up.
//      Its nav links now live in the CustomDB sidebar's "Operate" and
//      "Governance" sections.

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import {
  MemoryRouter, Routes, Route, Navigate, useNavigate, useLocation,
} from 'react-router-dom'
import { ConnectionsPage } from './pages/Connections'
import { ExplorePage } from './pages/Explore'
import { MonitorPage } from './pages/Monitor'
import { MovePage } from './pages/Move'
import { ProtectPage } from './pages/Protect'
import { SettingsPage } from './pages/Settings'
import { MigratePage } from './pages/Migrate'
import { SyncPage } from './pages/Sync'

/**
 * Propagates Next.js navigations into React Router.
 *
 * The dashboard sidebar links with next/link, which performs a client-side
 * navigation via history.pushState. Using BrowserRouter caused Next.js and
 * React Router to fight over the History API, leading to state tearing where
 * the UI lagged behind the URL by exactly one click.
 *
 * Switching to MemoryRouter isolates React Router. Next.js fully owns the
 * browser URL, and this bridge pushes those URL changes down into the
 * memory router to update the active page.
 */
function NextRouteBridge() {
  const nextPath = usePathname()
  const navigate = useNavigate()
  const location = useLocation()
  const lastNextPath = useRef(nextPath)

  useEffect(() => {
    if (nextPath === lastNextPath.current) return
    lastNextPath.current = nextPath

    const inner = (nextPath ?? '').replace(/^\/operate/, '') || '/'
    if (inner !== location.pathname) navigate(inner, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextPath, navigate])

  return null
}

export default function OperateApp() {
  const nextPath = usePathname()
  const initial = (nextPath ?? '').replace(/^\/operate/, '') || '/'

  return (
    <MemoryRouter initialEntries={[initial]}>
      <NextRouteBridge />
      <Routes>
        <Route path="/" element={<Navigate to="/connections" replace />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/monitor" element={<MonitorPage />} />
        <Route path="/move" element={<MovePage />} />
        <Route path="/protect" element={<ProtectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/migrate" element={<MigratePage />} />
        <Route path="/sync" element={<SyncPage />} />
      </Routes>
    </MemoryRouter>
  )
}
