import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Header } from '@/components/Header';
import { CookieConsent } from '@/components/CookieConsent';

export const metadata: Metadata = {
  title: { default: 'ShopStop — Buy & sell anything, safely', template: '%s · ShopStop' },
  description:
    'A trust-first peer-to-peer marketplace. Every transaction is backed by identity verification, fraud detection, and dispute resolution.',
  openGraph: { title: 'ShopStop', type: 'website' },
};

// Set the theme before first paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted">
          <div className="border-t pt-6">
            ShopStop — trust-first marketplace ·{' '}
            <Link className="underline" href="/legal/terms">
              Terms
            </Link>{' '}
            ·{' '}
            <Link className="underline" href="/legal/privacy">
              Privacy
            </Link>
          </div>
        </footer>
        <CookieConsent />
      </body>
    </html>
  );
}
