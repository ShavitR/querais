const COLS = ['QueraIS', 'Akash', 'Bittensor', 'io.net', 'Render'];

const ROWS: { dim: string; cells: string[] }[] = [
  {
    dim: 'Primary focus',
    cells: [
      'LLM inference',
      'General cloud compute',
      'AI via subnets',
      'GPU clusters for ML',
      'GPU rendering + AI',
    ],
  },
  { dim: 'OpenAI-compatible API', cells: ['Yes — drop-in', '—', '—', '—', '—'] },
  { dim: 'Permissionless GPU nodes', cells: ['Yes', 'Yes', 'Yes', 'Yes', 'Yes'] },
  {
    dim: 'Per-job quality verification',
    cells: ['Reputation + slashing', '—', 'Subnet incentives', '—', '—'],
  },
  { dim: 'Pay with', cells: ['$QAIS / wallet', 'AKT', 'TAO', 'Wallet / fiat', 'RENDER'] },
];

/** "How we compare" — QueraIS vs the main decentralized-compute networks. Cells use only
 *  defensible public positioning; disclaimed below. */
export function ComparisonTable() {
  return (
    <>
      <div className="table-wrap">
        <table className="table compare">
          <thead>
            <tr>
              <th>Dimension</th>
              {COLS.map((c, i) => (
                <th key={c} className={i === 0 ? 'mine' : undefined}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.dim}>
                <td className="muted">{r.dim}</td>
                {r.cells.map((cell, i) => (
                  <td key={COLS[i]} className={i === 0 ? 'mine num' : 'num'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Comparison reflects QueraIS&apos;s reading of each project&apos;s public positioning; these
        networks evolve fast — check their own docs for specifics.
      </p>
    </>
  );
}
