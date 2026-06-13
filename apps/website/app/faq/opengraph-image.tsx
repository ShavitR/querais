import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS FAQ';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage('FAQ', 'Privacy, models, running a node, anti-cheat, and decentralization.');
}
