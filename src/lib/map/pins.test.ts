import { describe, expect, it } from "vitest";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";
import { INITIAL_FIT, fitBounds, pinStyle } from "./pins";

function placeLog(
  id: string,
  longitude: number,
  latitude: number,
): PlaceLogSummary {
  return {
    id,
    name: `Place ${id}`,
    address: "123 Main St",
    longitude,
    latitude,
    entry_count: 1,
    last_captured_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("fitBounds", () => {
  it("spans every Place, so opening the map frames everywhere the family has eaten", () => {
    const placeLogs = [
      placeLog("a", -73.9, 40.7),
      placeLog("b", -74.2, 40.9),
      placeLog("c", -74.0, 40.5),
    ];

    expect(fitBounds(placeLogs)).toEqual([-74.2, 40.5, -73.9, 40.9]);
  });

  it("gives a single Place zero-area bounds, which the zoom clamp turns into a neighbourhood", () => {
    expect(fitBounds([placeLog("a", -73.9, 40.7)])).toEqual([
      -73.9, 40.7, -73.9, 40.7,
    ]);
    expect(INITIAL_FIT.maxZoom).toBeLessThan(18);
  });
});

describe("pinStyle", () => {
  it("makes the selected pin bigger, so hue is not the only thing telling it apart", () => {
    expect(pinStyle(true).fontSize).toBeGreaterThan(pinStyle(false).fontSize);
  });

  it("lifts the selected pin above its neighbours", () => {
    expect(pinStyle(true).zIndex).toBeGreaterThan(pinStyle(false).zIndex);
  });
});
