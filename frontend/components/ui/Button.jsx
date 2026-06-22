'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const sizes = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-10 px-4 text-base',
  lg: 'h-12 px-5 text-md',
};

const variants = {
  filled:
    'bg-accent text-white font-medium hover:bg-accent-hover active:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed',
  ghost:
    'bg-transparent text-text-primary border border-border-strong hover:bg-bg-inset hover:border-border-hover disabled:opacity-40 disabled:cursor-not-allowed',
  subtle:
    'bg-bg-inset text-text-primary hover:bg-bg-card border border-transparent disabled:opacity-40',
  danger:
    'bg-danger text-white font-medium hover:bg-[#dc2626] disabled:opacity-40',
};

const Button = forwardRef(function Button(
  { children, className, variant = 'filled', size = 'md', loading, disabled, leftIcon, rightIcon, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded transition-colors duration-150',
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
