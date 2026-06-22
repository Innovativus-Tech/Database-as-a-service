'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export default function CodeBlock({ children, language, copyValue, className }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(copyValue ?? String(children));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className={cn('relative rounded-lg border border-border-strong bg-[#0d0d0d]', className)}>
      <div className="flex items-center justify-between border-b border-border px-[14px] py-[10px]">
        <span className="font-mono text-[12px] font-medium text-text-secondary">{language || 'code'}</span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 text-[12px] text-text-secondary transition-colors hover:text-text-primary"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-sm leading-[1.7] text-text-primary">
        {children}
      </pre>
    </div>
  );
}
