import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS pricing';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage('Pricing', 'Nodes set their own per-token price; the protocol takes a flat 5%.');
}
