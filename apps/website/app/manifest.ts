import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QueraIS — decentralized AI inference',
    short_name: 'QueraIS',
    description:
      'BitTorrent for AI inference — an OpenAI-compatible API served by independent GPU nodes.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0f17',
    theme_color: '#0b0f17',
    icons: [{ src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' }],
  };
}
