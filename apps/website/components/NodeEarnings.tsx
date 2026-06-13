'use client';

import { useState } from 'react';

const fmt = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Back-of-envelope node earnings: throughput × price, minus the flat 5% protocol fee. */
export function NodeEarnings() {
  const [reqPerDay, setReqPerDay] = useState(2000);
  const [tokensPerReq, setTokensPerReq] = useState(400);
  const [pricePer1k, setPricePer1k] = useState(0.5); // QAIS / 1k tokens

  const tokensPerMonth = reqPerDay * tokensPerReq * 30;
  const gross = (tokensPerMonth / 1000) * pricePer1k;
  const net = gross * 0.95;

  return (
    <div className="calc">
      <label>
        Requests / day
        <input
          type="number"
          min={0}
          value={reqPerDay}
          onChange={(e) => setReqPerDay(Number(e.target.value) || 0)}
        />
      </label>
      <label>
        Avg tokens / request
        <input
          type="number"
          min={0}
          value={tokensPerReq}
          onChange={(e) => setTokensPerReq(Number(e.target.value) || 0)}
        />
      </label>
      <label>
        Your price / 1k tokens (QAIS)
        <input
          type="number"
          min={0}
          step="0.1"
          value={pricePer1k}
          onChange={(e) => setPricePer1k(Number(e.target.value) || 0)}
        />
      </label>
      <div className="out">
        <div>
          <b>{fmt(net)} QAIS</b> / month to you
        </div>
        <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>
          {fmt(gross)} gross · 95% yours · {fmt(gross * 0.05)} protocol fee (5%) ·{' '}
          {fmt(tokensPerMonth)} tokens/mo
        </div>
      </div>
    </div>
  );
}
