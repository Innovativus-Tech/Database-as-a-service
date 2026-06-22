'use client';

import { cn } from '@/lib/cn';

const variants = {
  default:     'bg-bg-card border border-border',
  inset:       'bg-bg-inset border border-border-strong',
  elevated:    'bg-bg-inset border border-border-strong shadow-[0_4px_16px_rgba(0,0,0,0.5),0_2px_4px_rgba(0,0,0,0.4)]',
  interactive: 'bg-bg-card border border-border transition-all duration-150 hover:border-border-hover hover:bg-[#181818]',
  selected:    'bg-bg-card border border-accent shadow-[0_0_0_3px_rgba(91,106,240,0.12)]',
};

export default function Card({ children, variant = 'default', className, ...props }) {
  return (
    <div className={cn('rounded-lg', variants[variant], className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }) {
  return <div className={cn('flex items-center justify-between gap-4 px-6 pt-5', className)}>{children}</div>;
}
export function CardBody({ children, className }) {
  return <div className={cn('p-6', className)}>{children}</div>;
}
export function CardFooter({ children, className }) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-border px-6 py-3', className)}>{children}</div>;
}
