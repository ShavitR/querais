/**
 * Poll an async loader on an interval (the gateway has no push channel for read data in
 * 10A — the retired inline dashboard polled every 2s; a WS/SSE feed is an optional later
 * optimization). Re-runs when `deps` change; ignores in-flight results after unmount.
 */
import { useEffect, useState } from 'react';

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function usePoll<T>(
  loader: () => Promise<T>,
  intervalMs: number,
  deps: ReadonlyArray<unknown> = [],
): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let alive = true;
    const tick = () => {
      loader()
        .then((data) => {
          if (alive) setState({ data, error: null, loading: false });
        })
        .catch((err: unknown) => {
          if (alive) {
            setState((prev) => ({
              data: prev.data,
              error: err instanceof Error ? err.message : 'request failed',
              loading: false,
            }));
          }
        });
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
