import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { LinkButton, Container, inputClass } from './ui';

const NAV = [
  { href: '/search', label: 'Browse' },
  { href: '/sell', label: 'Sell' },
  { href: '/messages', label: 'Messages' },
  { href: '/dashboard', label: 'Dashboard' },
];

/**
 * Translucent, hairline-thin chrome that stays out of the way. Nav links are plain
 * text at caption size — the only filled control in the bar is Sign in, so the eye
 * lands on the one thing a signed-out visitor is meant to do.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-[color-mix(in_srgb,var(--canvas)_82%,transparent)] backdrop-blur-xl backdrop-saturate-150">
      <Container width="wide">
        <div className="flex h-14 items-center gap-4 sm:gap-6">
          <Link
            href="/"
            className="shrink-0 text-headline font-semibold tracking-[-0.021em]"
            aria-label="ShopStop home"
          >
            ShopStop
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-caption text-muted transition-colors duration-200 hover:text-text"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <form action="/search" role="search" className="ml-auto hidden max-w-xs flex-1 sm:block">
            <label htmlFor="site-search" className="sr-only">
              Search listings
            </label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="Search"
              className={`${inputClass} py-1.5 text-caption`}
            />
          </form>

          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <NotificationBell />
            <ThemeToggle />
            <LinkButton href="/login" size="sm">
              Sign in
            </LinkButton>
          </div>
        </div>
      </Container>
    </header>
  );
}
