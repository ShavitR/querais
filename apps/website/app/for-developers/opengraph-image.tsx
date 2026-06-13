import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS for developers';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'For developers',
    'OpenAI-compatible. Change one line — the base URL — and ship on a GPU market.',
  );
}
