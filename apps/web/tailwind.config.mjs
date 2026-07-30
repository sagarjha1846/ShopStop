/**
 * Tokens live as CSS variables (globals.css) so light/dark swap without touching a
 * single class name. The type scale pairs every size with the leading and tracking
 * it needs — large type wants tighter tracking, small type wants looser — so a size
 * can never be used with the wrong optical settings by accident.
 *
 * This file is .mjs rather than .ts on purpose: Tailwind 3 can only read a TypeScript
 * config when `jiti` and `sucrase` happen to be installed, and when they are not it
 * falls back to a *default* theme without erroring — every custom token silently
 * disappears from the build. JSDoc gives the same editor typing with no loader.
 *
 * @type {import('tailwindcss').Config}
 */
const config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        sunken: 'var(--sunken)',
        hairline: 'var(--hairline)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent-hover)', fg: 'var(--accent-fg)' },
        link: 'var(--link)',
        verified: 'var(--verified)',
        success: 'var(--success)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        // Kept so existing markup that references `brand`/`border`/`bg` still resolves.
        brand: { DEFAULT: 'var(--accent)', fg: 'var(--accent-fg)' },
        border: 'var(--hairline)',
        bg: 'var(--canvas)',
      },
      fontSize: {
        micro: ['12px', { lineHeight: '1.33', letterSpacing: '0.01em' }],
        caption: ['13px', { lineHeight: '1.38', letterSpacing: '-0.003em' }],
        footnote: ['15px', { lineHeight: '1.42', letterSpacing: '-0.014em' }],
        body: ['17px', { lineHeight: '1.47', letterSpacing: '-0.022em' }],
        lead: ['19px', { lineHeight: '1.42', letterSpacing: '-0.02em' }],
        headline: ['21px', { lineHeight: '1.38', letterSpacing: '-0.021em' }],
        title: ['28px', { lineHeight: '1.21', letterSpacing: '-0.021em' }],
        display: ['40px', { lineHeight: '1.1', letterSpacing: '-0.021em' }],
        hero: ['56px', { lineHeight: '1.07', letterSpacing: '-0.024em' }],
        mega: ['72px', { lineHeight: '1.05', letterSpacing: '-0.026em' }],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '18px',
        xl: '24px',
        '2xl': '32px',
        pill: '980px',
      },
      maxWidth: {
        // Editorial measure for text, a little more room for the product grid.
        prose: '692px',
        content: '980px',
        wide: '1120px',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
      },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'rise-in': 'rise-in 0.6s var(--ease-out) both',
        'fade-in': 'fade-in 0.4s var(--ease-out) both',
      },
    },
  },
  plugins: [],
};

export default config;
