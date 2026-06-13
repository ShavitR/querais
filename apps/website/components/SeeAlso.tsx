import Link from 'next/link';

/** "See also" internal-linking block — every deep page points to its neighbours (SEO + UX). */
export function SeeAlso({ links }: { links: { href: string; title: string; desc: string }[] }) {
  return (
    <nav className="seealso" aria-label="See also">
      {links.map((l) => (
        <Link key={l.href} href={l.href}>
          <div className="t">{l.title} →</div>
          <div className="d">{l.desc}</div>
        </Link>
      ))}
    </nav>
  );
}
