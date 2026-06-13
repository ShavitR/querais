import { ogContentType, ogImage, ogSize } from '../../lib/og';

export const alt = 'QueraIS — run a node';
export const size = ogSize;
export const contentType = ogContentType;
export const dynamic = 'force-static';

export default function Image() {
  return ogImage('Run a node', 'Turn an idle GPU into income — serve LLMs, earn 95% of every job.');
}
