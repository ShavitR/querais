import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS architecture';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'Architecture',
    'Gateway, nodes, oracle, contracts — and the path to full decentralization.',
  );
}
