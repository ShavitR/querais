import { ogContentType, ogImage, ogSize } from '../../../lib/og';

export const alt = 'QueraIS quickstart';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'Quickstart',
    'Call the API in 2 minutes, or run a GPU node and earn $QAIS in ~5.',
  );
}
