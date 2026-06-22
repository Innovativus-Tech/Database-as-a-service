'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function CopyButton({ value, label = 'Copy', iconOnly = false }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  if (iconOnly || label === '') {
    return (
      <button
        onClick={onCopy}
        className="inline-flex text-text-secondary hover:text-text-primary transition-colors"
        title="Copy"
      >
        {copied
          ? <Check className="h-[15px] w-[15px] text-success" strokeWidth={1.75} />
          : <Copy className="h-[15px] w-[15px]" strokeWidth={1.75} />
        }
      </button>
    );
  }

  return (
    <button
      onClick={onCopy}
      className="h-[30px] px-2.5 border border-border rounded bg-transparent text-text-primary text-xs font-medium inline-flex items-center gap-1.5 hover:bg-bg-inset transition-colors"
    >
      {copied
        ? <><Check className="h-[13px] w-[13px] text-success" strokeWidth={1.75} />Copied!</>
        : <><Copy className="h-[13px] w-[13px]" strokeWidth={1.75} />{label}</>
      }
    </button>
  );
}
