import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS roadmap';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage('Roadmap', 'From testnet beta to a P2P, oracle-verified, DAO-governed network.');
}
