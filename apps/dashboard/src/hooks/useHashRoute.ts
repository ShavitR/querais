/**
 * Minimal hash router — no router dependency (the kit philosophy). The route is the part
 * after `#`, defaulting to `/`. Components read `useHashRoute()` and link with `#/path`.
 */
import { useEffect, useState } from 'react';

function current(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
