'use client';

import { useState } from 'react';

export default function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <button
      onClick={onCopy}
      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}
