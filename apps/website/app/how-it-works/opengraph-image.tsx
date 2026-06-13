import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'How QueraIS works';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'How it works',
    'Request → match → real inference → verify → on-chain settlement.',
  );
}
