import type { Metadata } from 'next';
import { Calculator } from '../../components/Calculator';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Nodes set their own per-token price; the protocol takes a flat 5%. Estimate any request with the cost calculator.',
};

export default function Pricing() {
  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <h1>Pricing</h1>
      <p className="muted" style={{ fontSize: 18, maxWidth: 720 }}>
        Each node sets its own per-token price; you pay what the matched node quotes. The protocol
        takes a flat <b>5%</b> — no other fees. (Testnet $QAIS has no real value.)
      </p>

      <section className="block" style={{ borderTop: 'none', paddingTop: 16 }}>
        <h2>Estimate a request</h2>
        <Calculator />
      </section>

      <section className="block">
        <h2>Where the 5% goes</h2>
        <div className="grid2">
          <div className="card">
            <h3>60% — operations</h3>
            <p>Retained by the protocol treasury for hosting, gas, grants, and incentives.</p>
          </div>
          <div className="card">
            <h3>20% — stakers</h3>
            <p>Paid pro-rata to node operators who stake $QAIS and secure the network.</p>
          </div>
          <div className="card">
            <h3>20% — burned 🔥</h3>
            <p>Permanently removed from the fixed 1B supply — the token is deflationary.</p>
          </div>
          <div className="card">
            <h3>Batched = cheap</h3>
            <p>
              A credit session settles thousands of calls in one transaction, so per-call gas is
              effectively zero.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
