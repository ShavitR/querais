import Link from 'next/link';
import { breadcrumbSchema } from '../lib/jsonld';
import { JsonLd } from './JsonLd';

/** Visual breadcrumb trail + matching BreadcrumbList JSON-LD. Home is prepended automatically. */
export function Breadcrumb({ items }: { items: { name: string; path: string }[] }) {
  const trail = [{ name: 'Home', path: '/' }, ...items];
  return (
    <>
      <JsonLd data={breadcrumbSchema(trail)} />
      <nav className="crumbs" aria-label="Breadcrumb">
        {trail.map((c, i) => (
          <span key={c.path}>
            {i > 0 && <span className="sep">/</span>}
            {i < trail.length - 1 ? (
              <Link href={c.path}>{c.name}</Link>
            ) : (
              <span aria-current="page">{c.name}</span>
            )}
          </span>
        ))}
      </nav>
    </>
  );
}
