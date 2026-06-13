import { ogContentType, ogImage, ogSize } from '../lib/og';

export const alt = 'QueraIS — BitTorrent for AI inference';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'BitTorrent for AI inference',
    'An OpenAI-compatible API served by independent GPU nodes that earn $QAIS.',
  );
}
