const STEPS = [
  { t: 'Request', s: 'OpenAI-style call' },
  { t: 'Match', s: 'best node wins' },
  { t: 'Serve', s: 'stream tokens' },
  { t: 'Verify', s: 'sample & score' },
  { t: 'Settle', s: '95% / 5% on-chain' },
];

/** Hand-authored on-brand SVG: the five-stage job lifecycle. Scales to its container; scrolls
 *  horizontally on narrow screens via the .diagram-wrap wrapper. */
export function LifecycleDiagram() {
  return (
    <div className="diagram-wrap">
      <svg
        viewBox="0 0 1000 150"
        className="diagram lifecycle"
        role="img"
        aria-label="Job lifecycle: request, match, serve, verify, then settle on-chain"
      >
        {STEPS.map((step, i) => {
          const x = 8 + i * 198;
          return (
            <g key={step.t}>
              <rect x={x} y={35} width={158} height={84} rx={14} fill="#111726" stroke="#1d2738" />
              <circle cx={x + 28} cy={63} r={15} fill="#2563eb" />
              <text
                x={x + 28}
                y={68}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="15"
                fontWeight="700"
              >
                {i + 1}
              </text>
              <text x={x + 52} y={62} fill="#d6e1ef" fontSize="17" fontWeight="600">
                {step.t}
              </text>
              <text x={x + 52} y={86} fill="#98a7c0" fontSize="12">
                {step.s}
              </text>
              {i < STEPS.length - 1 && (
                <g>
                  <line
                    x1={x + 160}
                    y1={77}
                    x2={x + 198}
                    y2={77}
                    stroke="#3b5bbf"
                    strokeWidth="2"
                  />
                  <path d={`M ${x + 196} 72 L ${x + 205} 77 L ${x + 196} 82 Z`} fill="#3b5bbf" />
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
