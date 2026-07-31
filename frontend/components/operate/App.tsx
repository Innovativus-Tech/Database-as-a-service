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

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConnectionsPage } from './pages/Connections'
import { ExplorePage } from './pages/Explore'
import { MonitorPage } from './pages/Monitor'
import { MovePage } from './pages/Move'
import { ProtectPage } from './pages/Protect'
import { SettingsPage } from './pages/Settings'
import { MigratePage } from './pages/Migrate'
import { SyncPage } from './pages/Sync'

export default function OperateApp() {
  return (
    <BrowserRouter basename="/operate">
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
