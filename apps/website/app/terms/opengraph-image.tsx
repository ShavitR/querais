import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS Terms of Service';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage(
    'Terms of Service',
    'Experimental, testnet-only. $QAIS is a valueless test token.',
  );
}
