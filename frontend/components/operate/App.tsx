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
  BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation,
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
 * navigation via history.pushState. React Router's BrowserRouter only listens
 * for `popstate`, and pushState does not fire it — so a sidebar click changed
 * the URL while the router kept rendering the previous screen. Whether the
 * view updated at all came down to whether Next happened to remount this
 * subtree, which is why navigating between Operate sections felt erratic and
 * sometimes appeared to hang.
 *
 * Only reacts when Next's pathname actually CHANGES. Comparing the two paths
 * on every render would fight React Router's own internal navigations (which
 * Next likewise cannot observe) and ping-pong between them.
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
    // location.pathname is read, not tracked: this must fire on Next
    // navigations only, never on React Router's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextPath, navigate])

  return null
}

export default function OperateApp() {
  return (
    <BrowserRouter basename="/operate">
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
    </BrowserRouter>
  )
}
