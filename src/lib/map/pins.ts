import type { PlaceLogSummary } from "@/app/api/place-logs/route";

/**
 * How the map opens: framed around everywhere the family has eaten. A
 * single Place's bounds have zero area, so fitting them alone would zoom to
 * a meaningless level -- the clamp gives it a neighbourhood instead.
 */
export const INITIAL_FIT = { padding: 56, maxZoom: 14 } as const;

/** The [west, south, east, north] box containing every Place. */
export function fitBounds(
  placeLogs: PlaceLogSummary[],
): [number, number, number, number] {
  const longitudes = placeLogs.map((placeLog) => placeLog.longitude);
  const latitudes = placeLogs.map((placeLog) => placeLog.latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

/**
 * Markers stack in the order they are rendered, so the selected Place goes
 * last -- with a panel that never closes, the pin is the only thing telling
 * you which Place you are reading about, and it must not sit behind a
 * neighbour.
 */
export function drawOrder(
  placeLogs: PlaceLogSummary[],
  selectedId: string | null,
): PlaceLogSummary[] {
  return [
    ...placeLogs.filter((placeLog) => placeLog.id !== selectedId),
    ...placeLogs.filter((placeLog) => placeLog.id === selectedId),
  ];
}
