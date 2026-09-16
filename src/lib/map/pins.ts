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
 * Everything about a pin that turns on whether its Place is the selected
 * one. Kept together because they are one decision -- "make the selected
 * pin unmistakable" -- and splitting them across this file and the JSX
 * meant two edits to change one thing.
 *
 * Red for a pin, green for the selected one, straight from the ask. Hexes
 * rather than palette slots: `error.main` would repaint every pin the
 * colour the app uses to say something has gone wrong, and would follow
 * any later tint of it. The two also differ in lightness, not just hue,
 * which is what the size difference is for as well -- red and green are
 * the pair that red-green colour blindness collapses.
 *
 * Stacking is set explicitly rather than by render order: `react-map-gl`
 * appends each Marker's element to the map on mount, so reordering the
 * React children leaves the DOM order alone.
 */
export function pinStyle(selected: boolean): {
  fontSize: number;
  color: string;
  zIndex: number;
} {
  return selected
    ? { fontSize: 44, color: "#f26419", zIndex: 1 }
    : { fontSize: 32, color: "#0770bb", zIndex: 0 };
}
