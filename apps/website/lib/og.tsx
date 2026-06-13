import { ImageResponse } from 'next/og';

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = 'image/png';

/** A branded 1200×630 social card (built at build time — works in static export). */
export function ogImage(title: string, subtitle: string) {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #0b0f17 0%, #131b2e 100%)',
        color: '#d6e1ef',
        padding: 72,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="52" height="52" viewBox="0 0 24 24">
          <rect width="24" height="24" rx="5.5" fill="#0e1422" />
          <path d="M14 3.5 L6.5 13 H10.5 L10 20.5 L17.5 10.5 H13 Z" fill="#3b82f6" />
        </svg>
        <div style={{ display: 'flex', fontSize: 38, fontWeight: 700, letterSpacing: -0.5 }}>
          QueraIS
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            display: 'flex',
            fontSize: 68,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          {title}
        </div>
        <div
          style={{ display: 'flex', fontSize: 30, color: '#9fb0c9', marginTop: 22, maxWidth: 960 }}
        >
          {subtitle}
        </div>
      </div>

      <div style={{ display: 'flex', fontSize: 24, color: '#7d8aa3' }}>
        querais.xyz · testnet — $QAIS has no real value
      </div>
    </div>,
    { ...ogSize },
  );
}
