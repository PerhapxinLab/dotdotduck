/**
 * useHeatRank — React hook wrapping HeatRank for live sorting.
 *
 * Usage:
 *   const { sorted, visit } = useHeatRank(items, (i) => i.id);
 *   <ul>
 *     {sorted.map(i => <li key={i.id} onClick={() => visit(i.id)}>{i.name}</li>)}
 *   </ul>
 *
 * Pair with dddk Cache for cross-session persistence:
 *   const cache = useMemo(() => new Cache({ tier: 'local' }), []);
 *   useHeatRank(items, idOf, { adapter: makeCacheAdapter(cache) });
 */

import { useMemo, useState, useCallback } from 'react';
import { HeatRank, type HeatRankOptions } from '../../utils/heat-rank';

export interface UseHeatRankResult<T> {
  /** Items sorted by frecency score (descending). */
  sorted: T[];
  /** Mark an item as visited — updates rankings on next render. */
  visit(id: string): void;
  /** Reset all scores in this scope. */
  reset(): void;
  /** Forget one item's score. */
  forget(id: string): void;
}

export function useHeatRank<T>(
  items: T[],
  idOf: (item: T) => string,
  options: HeatRankOptions = {}
): UseHeatRankResult<T> {
  const rank = useMemo(() => new HeatRank(options), [
    options.scope,
    options.halfLifeMs,
    options.maxVisitsPerItem,
    options.adapter,
  ]);

  const [tick, setTick] = useState(0);

  const sorted = useMemo(
    () => rank.sort(items, idOf),
    // tick included so visit() forces re-sort
    [items, idOf, rank, tick]
  );

  const visit = useCallback(
    (id: string) => {
      rank.visit(id);
      setTick((t) => t + 1);
    },
    [rank]
  );

  const reset = useCallback(() => {
    rank.reset();
    setTick((t) => t + 1);
  }, [rank]);

  const forget = useCallback(
    (id: string) => {
      rank.forget(id);
      setTick((t) => t + 1);
    },
    [rank]
  );

  return { sorted, visit, reset, forget };
}
