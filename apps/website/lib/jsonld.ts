/** Schema.org JSON-LD builders for the marketing site. */
import { REPO_URL, SITE_URL } from './site';

const DESC =
  'A decentralized marketplace for AI inference — an OpenAI-compatible API served by independent GPU nodes that earn $QAIS, settled on-chain on Arbitrum.';

export const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'QueraIS',
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
  description: DESC,
  sameAs: [REPO_URL],
};

export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'QueraIS',
  url: SITE_URL,
};

export const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'QueraIS',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  url: SITE_URL,
  description: DESC,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export function faqPageSchema(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}
