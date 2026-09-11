import { NextResponse } from "next/server";

type MapboxFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude?: number; longitude?: number };
  };
};

/**
 * A candidate restaurant, shaped the same whether it came from the nearby
 * suggestions or a manual text search. `mapbox_id` is the dedup key the
 * save step upserts `places` on (see docs/adr/0001-shared-deduped-place.md).
 */
export type Place = {
  mapbox_id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

const MAX_DISTANCE_METERS = 60;
const MAX_NEARBY_RESULTS = 5;
const MAPBOX_RESULT_LIMIT = 10;

// Mapbox canonical category for businesses that sell food (excludes grocery
// stores and supermarkets). Both modes are restricted to it so a manually
// searched Place is the same kind of thing as a suggested one.
const FOOD_CATEGORY = "food_and_drink";

class MapboxError extends Error {}

// Haversine distance in meters between two points.
function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function featureCoords(
  feature: MapboxFeature,
): { lat: number; lon: number } | null {
  const coords = feature.properties?.coordinates;
  if (
    typeof coords?.latitude === "number" &&
    typeof coords?.longitude === "number"
  ) {
    return { lat: coords.latitude, lon: coords.longitude };
  }
  const geo = feature.geometry?.coordinates;
  if (Array.isArray(geo) && geo.length === 2) {
    return { lat: geo[1], lon: geo[0] };
  }
  return null;
}

// A feature without an id or coordinates can't be saved as a Place, so it is
// dropped rather than offered as a pickable suggestion.
function toPlace(feature: MapboxFeature): Place | null {
  const mapboxId = feature.properties?.mapbox_id;
  const coords = featureCoords(feature);
  if (!mapboxId || !coords) return null;
  return {
    mapbox_id: mapboxId,
    name: feature.properties?.name ?? "Unknown",
    address:
      feature.properties?.full_address ??
      feature.properties?.place_formatted ??
      "",
    latitude: coords.lat,
    longitude: coords.lon,
  };
}

function dedupeByMapboxId(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    if (seen.has(place.mapbox_id)) return false;
    seen.add(place.mapbox_id);
    return true;
  });
}

async function fetchFeatures(url: URL): Promise<MapboxFeature[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new MapboxError(`Mapbox responded with ${res.status}`);
  }
  const data = (await res.json()) as { features?: MapboxFeature[] };
  return data.features ?? [];
}

async function findNearby(
  origin: { lat: number; lon: number },
  token: string,
): Promise<Place[]> {
  const url = new URL(
    `https://api.mapbox.com/search/searchbox/v1/category/${FOOD_CATEGORY}`,
  );
  url.searchParams.set("proximity", `${origin.lon},${origin.lat}`);
  url.searchParams.set("limit", String(MAPBOX_RESULT_LIMIT));
  url.searchParams.set("access_token", token);

  const candidates = (await fetchFeatures(url))
    .map((feature) => {
      const place = toPlace(feature);
      if (!place) return null;
      return {
        place,
        distance: distanceMeters(origin, {
          lat: place.latitude,
          lon: place.longitude,
        }),
      };
    })
    .filter(
      (candidate): candidate is { place: Place; distance: number } =>
        candidate !== null,
    )
    .filter((candidate) => candidate.distance <= MAX_DISTANCE_METERS)
    .sort((a, b) => a.distance - b.distance);

  return dedupeByMapboxId(candidates.map((candidate) => candidate.place)).slice(
    0,
    MAX_NEARBY_RESULTS,
  );
}

async function searchByText(query: string, token: string): Promise<Place[]> {
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("poi_category", FOOD_CATEGORY);
  url.searchParams.set("types", "poi");
  url.searchParams.set("limit", String(MAPBOX_RESULT_LIMIT));
  url.searchParams.set("access_token", token);

  const places = (await fetchFeatures(url))
    .map(toPlace)
    .filter((place): place is Place => place !== null);

  return dedupeByMapboxId(places);
}

export async function GET(request: Request) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Mapbox token is not configured." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  try {
    if (query !== null) {
      const trimmed = query.trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: "The 'q' query parameter must not be blank." },
          { status: 400 },
        );
      }
      return NextResponse.json({ places: await searchByText(trimmed, token) });
    }

    if (!lat || !lon || isNaN(Number(lat)) || isNaN(Number(lon))) {
      return NextResponse.json(
        {
          error:
            "Either a 'q' query parameter or valid 'lat' and 'lon' query parameters are required.",
        },
        { status: 400 },
      );
    }

    const origin = { lat: Number(lat), lon: Number(lon) };
    return NextResponse.json({ places: await findNearby(origin, token) });
  } catch (error) {
    if (error instanceof MapboxError) {
      return NextResponse.json(
        { error: "Unable to reach the place search service." },
        { status: 502 },
      );
    }
    throw error;
  }
}
