import Link from 'next/link';
import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border bg-surface shadow-sm ${className}`}>{children}</div>
  );
}

export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'verified' | 'success' | 'warn' | 'danger' | 'brand';
}) {
  const tones: Record<string, string> = {
    muted: 'bg-border text-muted',
    verified: 'text-white bg-[var(--verified)]',
    success: 'text-white bg-[var(--success)]',
    warn: 'text-white bg-[var(--warn)]',
    danger: 'text-white bg-[var(--danger)]',
    brand: 'bg-brand text-brand-fg',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'outline';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, string> = {
    primary: 'bg-brand text-brand-fg hover:opacity-90',
    ghost: 'text-text hover:bg-border',
    outline: 'border text-text hover:bg-border',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  href,
  variant = 'primary',
  className = '',
}: {
  children: ReactNode;
  href: string;
  variant?: 'primary' | 'ghost' | 'outline';
  className?: string;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-brand text-brand-fg hover:opacity-90',
    ghost: 'text-text hover:bg-border',
    outline: 'border text-text hover:bg-border',
  };
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
