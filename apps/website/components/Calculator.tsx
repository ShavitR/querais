'use client';

import { useState } from 'react';

const fmt = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 6 });

export function Calculator() {
  const [tokens, setTokens] = useState(1000);
  const [price, setPrice] = useState(0.0005); // QAIS per token (a typical node base price)
  const total = tokens * price;

  return (
    <div className="calc">
      <label>
        Tokens
        <input
          type="number"
          min={0}
          value={tokens}
          onChange={(e) => setTokens(Number(e.target.value) || 0)}
        />
      </label>
      <label>
        Price / token (QAIS)
        <input
          type="number"
          min={0}
          step="0.0001"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value) || 0)}
        />
      </label>
      <div className="out">
        <div>
          <b>{fmt(total)} QAIS</b> total
        </div>
        <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>
          {fmt(total * 0.95)} to the node (95%) · {fmt(total * 0.05)} protocol fee (5%)
        </div>
      </div>
    </div>
  );
}
