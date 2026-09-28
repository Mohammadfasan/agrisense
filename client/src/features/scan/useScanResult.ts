import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { fetchScan, scanKeys } from '@/api/scans';

export const POLL_FOR_MS = 2 * 60 * 1000;

function pollDelay(elapsedMs: number): number {
  if (elapsedMs < 20_000) {
    return 5_000;
  }
  if (elapsedMs < 60_000) {
    return 10_000;
  }
  return 20_000;
}

export function useScanResult(scanId: string) {
  const startedAt = useRef(Date.now());
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);

  const query = useQuery({
    queryKey: scanKeys.one(scanId),
    queryFn: () => fetchScan(scanId),
    refetchInterval: (current) => {
      if (current.state.data?.status !== 'pending') {
        return false;
      }
      const elapsed = Date.now() - startedAt.current;
      return elapsed >= POLL_FOR_MS ? false : pollDelay(elapsed);
    },
  });

  const isPending = query.data?.status === 'pending';

  useEffect(() => {
    if (!isPending) {
      return;
    }
    const remaining = Math.max(0, POLL_FOR_MS - (Date.now() - startedAt.current));
    const timer = setTimeout(() => {
      setWaitedLongEnough(true);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [isPending]);

  return { query, gaveUpWaiting: isPending && waitedLongEnough };
}
