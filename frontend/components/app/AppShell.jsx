'use client';

import Sidebar from './Sidebar';

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-bg-base">
      <Sidebar />
      <div className="pl-55">
        {children}
      </div>
    </div>
  );
}
