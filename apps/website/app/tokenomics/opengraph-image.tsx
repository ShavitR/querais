import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS tokenomics';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'Tokenomics',
    'Fixed 1B supply · flat 5% fee, split 60/20/20 · deflationary burn.',
  );
}
