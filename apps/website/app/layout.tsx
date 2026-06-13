import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';

export const metadata: Metadata = {
  metadataBase: new URL('https://querais.xyz'),
  title: {
    default: 'QueraIS — decentralized AI inference marketplace',
    template: '%s · QueraIS',
  },
  description:
    'BitTorrent for AI inference. Call an OpenAI-compatible API served by independent GPU nodes that earn $QAIS — every job settles on-chain, 95% to the node, 5% protocol fee. Testnet on Arbitrum Sepolia.',
  keywords: [
    'decentralized AI',
    'LLM inference',
    'GPU marketplace',
    'Arbitrum',
    'OpenAI-compatible',
  ],
  openGraph: {
    title: 'QueraIS — BitTorrent for AI inference',
    description: 'An OpenAI-compatible API served by independent GPU nodes that earn $QAIS.',
    url: 'https://querais.xyz',
    siteName: 'QueraIS',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="banner">
          ⚠ Testnet (Arbitrum Sepolia) — $QAIS has <b>no real value</b>. Your prompts run on
          strangers&apos; machines; don&apos;t send anything secret.
        </div>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
