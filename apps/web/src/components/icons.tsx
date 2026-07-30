/**
 * Inline glyphs, drawn on a 20px grid with a consistent 1.5px stroke.
 *
 * These replace the emoji the chrome used to render: emoji pick up the platform's
 * own colour and metrics, so they never sit right next to typography you control,
 * and they can't inherit the theme. A stroked glyph inherits `currentColor` and
 * stays on the same optical footing as the text beside it.
 */
type IconProps = { className?: string };

const base = 'h-[18px] w-[18px]';
const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function SunIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`${base} ${className}`} {...strokeProps}>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M15.95 4.05l-1.4 1.4M5.45 14.55l-1.4 1.4M15.95 15.95l-1.4-1.4M5.45 5.45l-1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`${base} ${className}`} {...strokeProps}>
      <path d="M17 11.5A7.5 7.5 0 0 1 8.5 3a7.5 7.5 0 1 0 8.5 8.5Z" />
    </svg>
  );
}

export function BellIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`${base} ${className}`} {...strokeProps}>
      <path d="M10 2.5a5 5 0 0 0-5 5c0 3.5-1.25 4.75-1.25 4.75h12.5S15 11 15 7.5a5 5 0 0 0-5-5Z" />
      <path d="M11.5 15a1.75 1.75 0 0 1-3 0" />
    </svg>
  );
}

/** Filled when saved, outlined when not — the state is the shape, not just colour. */
export function HeartIcon({ filled = false, className = '' }: IconProps & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={`${base} ${className}`}
      {...strokeProps}
      fill={filled ? 'currentColor' : 'none'}
    >
      <path d="M10 16.5S3 12.5 3 7.9A3.4 3.4 0 0 1 6.4 4.5c1.5 0 2.8.9 3.6 2.2.8-1.3 2.1-2.2 3.6-2.2A3.4 3.4 0 0 1 17 7.9c0 4.6-7 8.6-7 8.6Z" />
    </svg>
  );
}
