'use client';

import Link from 'next/link';
import { track } from '@vercel/analytics';

/**
 * A primary CTA that fires a Vercel Analytics custom event on click. Renders an external <a> for
 * absolute URLs and next/link for internal routes. Analytics no-ops off Vercel, so this is inert
 * in local/CI builds.
 */
export function CtaLink({
  event,
  href,
  className,
  children,
}: {
  event: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const onClick = () => track(event);
  if (href.startsWith('http')) {
    return (
      <a href={href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
