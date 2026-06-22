'use client';

import { Sparkles } from 'lucide-react';
import AppShell from './AppShell';
import Topbar from './Topbar';
import EmptyState from '@/components/ui/EmptyState';
import { useRequireAuth } from '@/lib/auth';

export default function ComingSoon({ title, subtitle, message }) {
  useRequireAuth();
  return (
    <AppShell>
      <Topbar title={title} subtitle={subtitle} />
      <main className="px-8 py-12">
        <EmptyState
          icon={Sparkles}
          title="Coming next"
          description={message || 'This page is being designed and built in the next batch.'}
        />
      </main>
    </AppShell>
  );
}
