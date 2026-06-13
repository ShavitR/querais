import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS Privacy Notice';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'Privacy Notice',
    '~5% of prompts are re-run; only hashes persist; on-chain data is forever.',
  );
}
