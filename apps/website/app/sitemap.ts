import type { MetadataRoute } from 'next';
import { ROUTES, SITE_URL } from '../lib/site';

// Static export pre-renders this to /sitemap.xml at build time.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = '2026-06-13';
  return ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified,
    changeFrequency: r.path === '/' ? 'daily' : 'weekly',
    priority: r.priority,
  }));
}
