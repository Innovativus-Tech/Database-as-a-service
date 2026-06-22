'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

const Input = forwardRef(function Input(
  { label, error, helper, leftIcon, rightSlot, className, id, ...props },
  ref
) {
  const reactId = useId();
  const inputId = id || `input-${reactId}`;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div
        className={cn(
          'flex items-center gap-2 rounded border bg-bg-inset px-3 transition-colors',
          error
            ? 'border-danger focus-within:border-danger'
            : 'border-border-strong focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(91,106,240,0.18)]',
        )}
      >
        {leftIcon && <span className="text-text-secondary">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-10 w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none',
            className
          )}
          {...props}
        />
        {rightSlot}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : helper ? (
        <p className="mt-1.5 text-xs text-text-muted">{helper}</p>
      ) : null}
    </div>
  );
});

export default Input;
