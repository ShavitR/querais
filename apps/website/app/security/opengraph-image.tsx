import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS security & verification';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'Security & verification',
    'Layered output checks, reputation, slashing, and commit-reveal disputes.',
  );
}
