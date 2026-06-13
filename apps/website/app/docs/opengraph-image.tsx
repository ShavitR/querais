import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS docs';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage('Docs', 'Quickstart, how it works, SDKs, and the full project reference.');
}
