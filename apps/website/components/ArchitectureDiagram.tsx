/** Hand-authored on-brand SVG: the layered system — developers → gateway → nodes + oracle →
 *  on-chain contracts. Scales to its container; scrolls horizontally on narrow screens. */
export function ArchitectureDiagram() {
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    sub: string,
    accent = false,
  ) => (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        fill={accent ? '#0e1730' : '#111726'}
        stroke={accent ? '#2563eb' : '#1d2738'}
        strokeWidth={accent ? 2 : 1}
      />
      <text
        x={x + w / 2}
        y={y + h / 2 - 4}
        textAnchor="middle"
        fill="#d6e1ef"
        fontSize="17"
        fontWeight="600"
      >
        {title}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 18} textAnchor="middle" fill="#98a7c0" fontSize="12.5">
        {sub}
      </text>
    </g>
  );

  const arrow = (x1: number, y1: number, x2: number, y2: number) => (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2 - 7} stroke="#3b5bbf" strokeWidth="2" />
      <path d={`M ${x2 - 5} ${y2 - 9} L ${x2} ${y2} L ${x2 + 5} ${y2 - 9} Z`} fill="#3b5bbf" />
    </g>
  );

  return (
    <div className="diagram-wrap">
      <svg
        viewBox="0 0 1000 470"
        className="diagram arch"
        role="img"
        aria-label="Layered architecture: developers and SDKs call the gateway, which routes to GPU nodes and the verification oracle, all settling on Arbitrum smart contracts"
      >
        {box(300, 10, 400, 64, 'Developers & SDKs', 'OpenAI-compatible requests')}
        {arrow(500, 74, 500, 120)}
        {box(
          180,
          120,
          640,
          76,
          'Gateway',
          'matching · streaming · verification · settlement',
          true,
        )}
        {arrow(360, 196, 300, 250)}
        {arrow(640, 196, 700, 250)}
        {box(120, 250, 360, 76, 'GPU nodes', 'stake $QAIS · serve models · earn 95%')}
        {box(520, 250, 360, 76, 'Verification oracle', 're-runs ~5% · scores reputation')}
        {arrow(300, 326, 420, 384)}
        {arrow(700, 326, 580, 384)}
        {box(
          180,
          384,
          640,
          76,
          'Arbitrum contracts',
          'token · registry · escrow · disputes · treasury',
        )}
      </svg>
    </div>
  );
}
