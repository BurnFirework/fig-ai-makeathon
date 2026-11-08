import type { CSSProperties } from 'react'

// Hand-drawn "die-cut sticker" decorations used across the board chrome and cards.
// All are purely decorative: aria-hidden and non-interactive.

interface StickerProps { size?: number; className?: string; style?: CSSProperties }

const cx = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ')

export function Bow({ size = 56, className, style }: StickerProps) {
  return <svg className={cx('sticker', className)} style={style} width={size} height={size * 0.82} viewBox="0 0 64 52" fill="none" aria-hidden="true">
    <path d="M29.5 26.5c-3.6 7.6-8.4 15.4-13.8 22.3l7.3-.6 3.4 3.8c3.5-7.9 5.9-16.4 7.1-25.3z" strokeWidth="1.4" strokeLinejoin="round" style={{ fill: 'var(--st-mid)', stroke: 'var(--st-line)' }}/>
    <path d="M34.5 26.5c3.6 7.6 8.4 15.4 13.8 22.3l-7.3-.6-3.4 3.8c-3.5-7.9-5.9-16.4-7.1-25.3z" strokeWidth="1.4" strokeLinejoin="round" style={{ fill: 'var(--st-mid)', stroke: 'var(--st-line)' }}/>
    <path d="M30 22.5C21.8 10.3 8.6 5.6 4.6 12c-4.3 7 5.7 15.8 25.4 13.3z" strokeWidth="1.4" strokeLinejoin="round" style={{ fill: 'var(--st-light)', stroke: 'var(--st-line)' }}/>
    <path d="M34 22.5c8.2-12.2 21.4-16.9 25.4-10.5 4.3 7-5.7 15.8-25.4 13.3z" strokeWidth="1.4" strokeLinejoin="round" style={{ fill: 'var(--st-light)', stroke: 'var(--st-line)' }}/>
    <path d="M10 12.5c5 .8 10.6 4.4 15.4 9.4M54 12.5c-5 .8-10.6 4.4-15.4 9.4" stroke="#fff" strokeOpacity=".75" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M12 18.5c4 1.8 8.5 3.6 13.5 4.6M52 18.5c-4 1.8-8.5 3.6-13.5 4.6" strokeWidth="1" strokeLinecap="round" style={{ stroke: 'var(--st-shine)' }}/>
    <rect x="27.3" y="18.6" width="9.4" height="10.4" rx="4.2" strokeWidth="1.4" style={{ fill: 'var(--st-deep)', stroke: 'var(--st-line)' }}/>
  </svg>
}

export function Heart({ size = 22, className, style, outline = false }: StickerProps & { outline?: boolean }) {
  return <svg className={cx(outline ? undefined : 'sticker', className)} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 20.6s-7.6-4.5-9.7-9.3C.9 8 2.9 4.4 6.6 4.4c2.3 0 3.9 1.3 5.4 3.3 1.5-2 3.1-3.3 5.4-3.3 3.7 0 5.7 3.6 4.3 6.9-2.1 4.8-9.7 9.3-9.7 9.3z" style={{ fill: outline ? 'none' : 'var(--st-deep)', stroke: outline ? 'currentColor' : 'var(--st-line)' }} strokeWidth="1.5" strokeLinejoin="round"/>
    {!outline && <path d="M6.4 7.4c-1.4.2-2.2 1.5-2 3" stroke="#fff" strokeOpacity=".85" strokeWidth="1.5" strokeLinecap="round"/>}
  </svg>
}

export function Sparkle({ size = 18, className, style, color = 'var(--st-mid)' }: StickerProps & { color?: string }) {
  return <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1.5c.8 5.6 4.3 9.3 10.5 10.5-6.2 1.2-9.7 4.9-10.5 10.5-.8-5.6-4.3-9.3-10.5-10.5C7.7 10.8 11.2 7.1 12 1.5z" style={{ fill: color }}/>
  </svg>
}

export function Blossom({ size = 34, className, style }: StickerProps) {
  return <svg className={cx('sticker', className)} style={style} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <g strokeWidth="1.1" style={{ fill: 'var(--st-light)', stroke: 'var(--st-line)' }}>
      {[0, 72, 144, 216, 288].map(angle => <path key={angle} d="M20 19c-4.6-2.3-6.6-7-4.9-10.6 1-2.1 3.2-2.6 4.9-1 1.7-1.6 3.9-1.1 4.9 1C26.6 12 24.6 16.7 20 19z" transform={`rotate(${angle} 20 20)`}/>)}
    </g>
    <circle cx="20" cy="20" r="4" fill="#F6D68C" stroke="#E2B65E" strokeWidth="1"/>
    <circle cx="18.6" cy="18.8" r="1" fill="#fff" fillOpacity=".8"/>
  </svg>
}

export function Rose({ size = 70, className, style }: StickerProps) {
  return <svg className={cx('sticker', className)} style={style} width={size * 0.55} height={size} viewBox="0 0 60 110" fill="none" aria-hidden="true">
    <path d="M30 48c1.6 22-2.4 38 .5 58" stroke="#628B52" strokeWidth="2.6" strokeLinecap="round"/>
    <path d="M30.2 74C21 64 10.5 66 6 72.5c8.6 5.5 17.5 6.4 24.2 1.5z" fill="#86AE70" stroke="#5E8A4E" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M30.4 88c8.6-10.5 19.2-9.6 24-3.4-8.2 6-17 7.4-24 3.4z" fill="#86AE70" stroke="#5E8A4E" strokeWidth="1.2" strokeLinejoin="round"/>
    <path d="M10 72.4c6.2.6 12.5 1 19 1.5M50.6 84.8c-6 .9-12.8 2.2-19.6 3" stroke="#5E8A4E" strokeWidth=".9" strokeLinecap="round"/>
    <path d="M22 45.5c2.6 3 5.4 4.2 8 4.2s5.4-1.2 8-4.2l-3 7.5h-10z" fill="#7AA565" stroke="#5E8A4E" strokeWidth="1" strokeLinejoin="round"/>
    <path d="M12.5 31.5C12 18 20.5 9 30 9s18 9 17.5 22.5C47 42 39.6 48.5 30 48.5S13 42 12.5 31.5z" strokeWidth="1.3" style={{ fill: 'var(--st-mid)', stroke: 'var(--st-line)' }}/>
    <path d="M17 33c1.7-9 7-14 13-14s11.3 5 13 14c-3.2 6.6-7.6 9.6-13 9.6S20.2 39.6 17 33z" strokeWidth="1.1" style={{ fill: 'var(--st-deep)', stroke: 'var(--st-line)' }}/>
    <path d="M21.5 26.5c2.6-5.2 5.6-7.6 8.5-7.6s5.9 2.4 8.5 7.6c-2.2 4.4-5 6.6-8.5 6.6s-6.3-2.2-8.5-6.6z" strokeWidth="1" style={{ fill: 'var(--st-light)', stroke: 'var(--st-line)' }}/>
    <path d="M25.5 25.6c1.4-2.6 2.9-3.8 4.5-3.8s3.1 1.2 4.5 3.8c-1.2 1.8-2.6 2.7-4.5 2.7s-3.3-.9-4.5-2.7z" style={{ fill: 'var(--st-shine)' }}/>
    <path d="M15 22c3.4-5.6 8.8-8.6 15-8.6M45 22c-3.4-5.6-8.8-8.6-15-8.6" stroke="#fff" strokeOpacity=".6" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
}

/** Translucent washi-tape strip; positioned with CSS. */
export function Tape({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cx('tape', className)} style={style} aria-hidden="true"/>
}
