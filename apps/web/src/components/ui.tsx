import Link from 'next/link';
import type { ReactNode } from 'react';

/* ---------------------------------------------------------------- layout ---- */

/**
 * Page measure. `content` (980px) is the default for most pages; `wide` gives the
 * product grid more room; `prose` keeps long-form text at a readable line length.
 */
export function Container({
  children,
  width = 'content',
  className = '',
}: {
  children: ReactNode;
  width?: 'prose' | 'content' | 'wide';
  className?: string;
}) {
  const widths = { prose: 'max-w-prose', content: 'max-w-content', wide: 'max-w-wide' };
  return (
    <div className={`mx-auto w-full ${widths[width]} px-5 sm:px-6 ${className}`}>{children}</div>
  );
}

/**
 * A titled block. The eyebrow is for a genuine category or count — something true
 * about the section — not ornament, so it is optional and unstyled when absent.
 */
export function Section({
  title,
  eyebrow,
  action,
  children,
  className = '',
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`py-10 sm:py-14 ${className}`}>
      {(title || eyebrow || action) && (
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="mb-1 text-micro font-medium uppercase text-faint">{eyebrow}</p>
            )}
            {title && <h2 className="text-title font-semibold">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- cards ---- */

/**
 * A content tile. Tiles are separated from the canvas by their fill, not by an
 * outline — that is the core move of this design language, so `Card` has no border.
 */
export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'li';
}) {
  return <Tag className={`rounded-lg bg-surface shadow-card ${className}`}>{children}</Tag>;
}

/** Horizontal hairline. Use where structure genuinely divides, not for rhythm. */
export function Divider({ className = '' }: { className?: string }) {
  return <hr className={`border-0 border-t border-hairline ${className}`} />;
}

/* ---------------------------------------------------------------- badges ---- */

/**
 * Status pill. Tones are tinted rather than filled: a badge reports state, it is not
 * a call to action, so it must not compete with the accent colour.
 */
export function Badge({
  children,
  tone = 'muted',
  className = '',
}: {
  children: ReactNode;
  tone?: 'muted' | 'verified' | 'success' | 'warn' | 'danger' | 'brand';
  className?: string;
}) {
  const tones: Record<string, string> = {
    muted: 'bg-sunken text-muted',
    verified: 'bg-[color-mix(in_srgb,var(--verified)_12%,transparent)] text-verified',
    success: 'bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-success',
    warn: 'bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-warn',
    danger: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger',
    brand: 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-accent',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-micro font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- buttons ---- */

const SIZES = {
  sm: 'px-4 py-1.5 text-caption',
  md: 'px-5 py-2.5 text-footnote',
  lg: 'px-7 py-3 text-body',
} as const;

const VARIANTS = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-sunken text-text hover:brightness-95 dark:hover:brightness-125',
  outline: 'border border-hairline text-text hover:bg-sunken',
  ghost: 'text-text hover:bg-sunken',
  // Text-styled action for destructive choices — never a red filled button.
  danger: 'text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]',
  link: 'text-link hover:underline px-0 py-0',
} as const;

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-pill font-medium transition-[background-color,color,opacity,filter] duration-200 ease-out disabled:pointer-events-none disabled:opacity-40';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: {
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: {
  children: ReactNode;
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link
      href={href}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------- forms ---- */

/** Recessed input. Inputs read as wells cut into the surface, not as outlined boxes. */
export const inputClass =
  'w-full rounded-md bg-sunken px-3.5 py-2.5 text-footnote text-text placeholder:text-faint outline-none transition-shadow duration-200 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)]';

/** Labelled field with room for help text and a validation message. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-caption font-medium text-muted">{label}</span>
      {children}
      {/* Errors say what happened and what to do; they replace the hint, not stack with it. */}
      {error ? (
        <span className="mt-1.5 block text-caption text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-caption text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

/* ----------------------------------------------------------------- state ---- */

/** An empty screen is an invitation to act, so this always takes an action. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface px-6 py-16 text-center shadow-card">
      <p className="text-headline font-semibold">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-sm text-footnote text-muted">{body}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

/** Placeholder block for loading states; pairs with the sunken well colour. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-sunken ${className}`} />;
}

/** Page title block. Every page opens the same way so the app feels like one product. */
export function PageHeader({
  title,
  description,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div>
        <h1 className="text-title font-semibold">{title}</h1>
        {description && <p className="mt-1 text-caption text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

/**
 * Shown where a signed-out visitor lands on a personal page. It says what is behind
 * the wall rather than just demanding a login.
 */
export function SignInPrompt({ next, what }: { next: string; what: string }) {
  return (
    <EmptyState
      title={`Sign in to see ${what}`}
      body="Your account keeps your orders, saved items and messages in one place."
      action={<LinkButton href={`/login?next=${encodeURIComponent(next)}`}>Sign in</LinkButton>}
    />
  );
}

/** Quiet inline loading line. Deliberately plain — a spinner on every page is noise. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="py-16 text-center text-caption text-muted">
      {label}
    </p>
  );
}
