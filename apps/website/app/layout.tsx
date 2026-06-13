import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { JsonLd } from '../components/JsonLd';
import { organizationSchema, websiteSchema } from '../lib/jsonld';
import { SITE_URL } from '../lib/site';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
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
    'OpenAI-compatible API',
    'AI compute',
    '$QAIS',
  ],
  applicationName: 'QueraIS',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'QueraIS — BitTorrent for AI inference',
    description: 'An OpenAI-compatible API served by independent GPU nodes that earn $QAIS.',
    url: SITE_URL,
    siteName: 'QueraIS',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'QueraIS — BitTorrent for AI inference',
    description: 'An OpenAI-compatible API served by independent GPU nodes that earn $QAIS.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <div className="banner">
          ⚠ Testnet (Arbitrum Sepolia) — $QAIS has <b>no real value</b>. Your prompts run on
          strangers&apos; machines; don&apos;t send anything secret.
        </div>
        <Nav />
        <main id="main">{children}</main>
        <Footer />
        <JsonLd data={organizationSchema} />
        <JsonLd data={websiteSchema} />
      </body>
    </html>
  );
}
