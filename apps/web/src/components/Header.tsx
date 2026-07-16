import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { LinkButton } from './ui';

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Shop<span className="text-brand">Stop</span>
        </Link>
        <form action="/search" className="flex-1">
          <input
            name="q"
            placeholder="Search anything…"
            className="w-full rounded-md border bg-bg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand"
          />
        </form>
        <nav className="flex items-center gap-2">
          <LinkButton href="/sell" variant="primary" className="hidden sm:inline-flex">
            Sell
          </LinkButton>
          <LinkButton href="/messages" variant="ghost" className="hidden sm:inline-flex">
            Messages
          </LinkButton>
          <LinkButton href="/dashboard" variant="ghost" className="hidden sm:inline-flex">
            Dashboard
          </LinkButton>
          <NotificationBell />
          <LinkButton href="/login" variant="ghost">
            Sign in
          </LinkButton>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
