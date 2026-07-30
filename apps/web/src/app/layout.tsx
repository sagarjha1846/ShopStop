import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Header } from '@/components/Header';
import { CookieConsent } from '@/components/CookieConsent';
import { Container } from '@/components/ui';

export const metadata: Metadata = {
  title: { default: 'ShopStop — Buy and sell anything, safely', template: '%s · ShopStop' },
  description:
    'A trust-first peer-to-peer marketplace. Every transaction is backed by identity verification, fraud detection, and dispute resolution.',
  openGraph: { title: 'ShopStop', type: 'website' },
};

// Set the theme before first paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

const FOOTER = [
  { href: '/search', label: 'Browse' },
  { href: '/sell', label: 'Sell' },
  { href: '/support', label: 'Support' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/cookies', label: 'Cookies' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col">
        {/* First stop for keyboard and screen-reader users. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pill focus:bg-accent focus:px-4 focus:py-2 focus:text-caption focus:text-accent-fg"
        >
          Skip to content
        </a>
        <Header />
        {/* Pages get their measure here so each one doesn't re-declare it. */}
        <main id="main" className="flex-1 py-8 sm:py-10">
          <Container width="wide">{children}</Container>
        </main>
        <footer className="mt-8 border-t border-hairline py-10">
          <Container width="wide">
            <nav className="flex flex-wrap gap-x-6 gap-y-2">
              {FOOTER.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-caption text-muted transition-colors duration-200 hover:text-text"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <p className="mt-4 text-caption text-faint">ShopStop — a trust-first marketplace.</p>
          </Container>
        </footer>
        <CookieConsent />
      </body>
    </html>
  );
}
