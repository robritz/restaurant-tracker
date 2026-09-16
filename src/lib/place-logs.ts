/**
 * How many dishes one PlaceLog carries at most. Not expected to be
 * reached -- it exists so one request can never sign an unbounded number
 * of URLs -- but the panel has to know it too: promising more skeleton
 * tiles than can arrive is the reflow the gallery is built to avoid.
 */
export const MAX_PLACE_LOG_ENTRIES = 50;

/** How many placeholder tiles to draw while a Place's photos load. */
export function skeletonCount(entryCount: number): number {
  return Math.min(entryCount, MAX_PLACE_LOG_ENTRIES);
}
