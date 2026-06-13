import { ogContentType, ogImage, ogSize } from '../../../lib/og';

export const alt = 'QueraIS API reference';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'API reference',
    'OpenAI-compatible endpoints plus the marketplace and credit surface.',
  );
}
