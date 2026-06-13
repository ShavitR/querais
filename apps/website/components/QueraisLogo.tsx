/** The QueraIS brand mark (lightning bolt) + optional wordmark — used in the nav/footer. */
export function QueraisLogo({ size = 24, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, lineHeight: 1 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        style={{ flex: '0 0 auto' }}
      >
        <rect width="24" height="24" rx="5.5" fill="#0e1422" />
        <path d="M14 3.5 L6.5 13 H10.5 L10 20.5 L17.5 10.5 H13 Z" fill="#3b82f6" />
      </svg>
      {wordmark ? <span>QueraIS</span> : null}
    </span>
  );
}
