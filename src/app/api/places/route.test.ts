import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// Route Handlers are tested by importing the module directly, constructing a
// Request, and mocking the outbound Mapbox fetch -- no running server.
type MapboxFeatureFixture = {
  properties: {
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    coordinates?: { latitude: number; longitude: number };
  };
};

function mapboxFeature(
  mapboxId: string,
  name: string,
  latitude: number,
  longitude: number,
  address = "123 Main St",
): MapboxFeatureFixture {
  return {
    properties: {
      mapbox_id: mapboxId,
      name,
      full_address: address,
      coordinates: { latitude, longitude },
    },
  };
}

function mockMapbox(features: MapboxFeatureFixture[]) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ features }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn>): URL {
  return new URL(String(fetchMock.mock.calls[0][0]));
}

const ORIGIN = { lat: 40.0, lon: -73.0 };

// ~0.00001 degrees of latitude is a bit over 1 meter.
function metersNorth(meters: number): number {
  return ORIGIN.lat + meters / 111_320;
}

describe("GET /api/places", () => {
  beforeEach(() => {
    vi.stubEnv("MAPBOX_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function get(query: string) {
    const response = await GET(new Request(`http://localhost/api/places?${query}`));
    return { response, body: await response.json() };
  }

  describe("proximity mode (?lat=&lon=)", () => {
    it("returns places in the Place shape, including the Mapbox place id", async () => {
      mockMapbox([
        mapboxFeature("mbx.1", "Test Diner", ORIGIN.lat, ORIGIN.lon, "123 Main St"),
      ]);

      const { response, body } = await get("lat=40.0&lon=-73.0");

      expect(response.status).toBe(200);
      expect(body.places).toEqual([
        {
          mapbox_id: "mbx.1",
          name: "Test Diner",
          address: "123 Main St",
          latitude: ORIGIN.lat,
          longitude: ORIGIN.lon,
        },
      ]);
    });

    it("restricts the Mapbox query to the food_and_drink category", async () => {
      const fetchMock = mockMapbox([]);

      await get("lat=40.0&lon=-73.0");

      const url = requestedUrl(fetchMock);
      expect(url.pathname).toContain("/category/food_and_drink");
      expect(url.searchParams.get("proximity")).toBe("-73,40");
    });

    it("sorts by distance from the given point", async () => {
      mockMapbox([
        mapboxFeature("mbx.far", "Far Cafe", metersNorth(50), ORIGIN.lon),
        mapboxFeature("mbx.near", "Near Cafe", metersNorth(5), ORIGIN.lon),
      ]);

      const { body } = await get("lat=40.0&lon=-73.0");

      expect(body.places.map((p: { name: string }) => p.name)).toEqual([
        "Near Cafe",
        "Far Cafe",
      ]);
    });

    it("drops places beyond the distance radius", async () => {
      mockMapbox([
        mapboxFeature("mbx.near", "Near Cafe", metersNorth(10), ORIGIN.lon),
        mapboxFeature("mbx.away", "Across Town", metersNorth(5000), ORIGIN.lon),
      ]);

      const { body } = await get("lat=40.0&lon=-73.0");

      expect(body.places.map((p: { name: string }) => p.name)).toEqual([
        "Near Cafe",
      ]);
    });

    it("caps the number of results", async () => {
      mockMapbox(
        Array.from({ length: 9 }, (_, i) =>
          mapboxFeature(`mbx.${i}`, `Cafe ${i}`, metersNorth(i + 1), ORIGIN.lon),
        ),
      );

      const { body } = await get("lat=40.0&lon=-73.0");

      expect(body.places).toHaveLength(5);
    });

    it("dedupes repeated Mapbox place ids", async () => {
      mockMapbox([
        mapboxFeature("mbx.1", "Test Diner", metersNorth(5), ORIGIN.lon),
        mapboxFeature("mbx.1", "Test Diner", metersNorth(6), ORIGIN.lon),
      ]);

      const { body } = await get("lat=40.0&lon=-73.0");

      expect(body.places).toHaveLength(1);
    });

    it("drops results that cannot become a Place (no id or no coordinates)", async () => {
      mockMapbox([
        { properties: { name: "No Id Cafe", coordinates: { latitude: ORIGIN.lat, longitude: ORIGIN.lon } } },
        { properties: { mapbox_id: "mbx.2", name: "No Coords Cafe" } },
        mapboxFeature("mbx.3", "Good Cafe", ORIGIN.lat, ORIGIN.lon),
      ]);

      const { body } = await get("lat=40.0&lon=-73.0");

      expect(body.places.map((p: { name: string }) => p.name)).toEqual([
        "Good Cafe",
      ]);
    });

    it("rejects non-numeric coordinates", async () => {
      mockMapbox([]);

      const { response } = await get("lat=abc&lon=-73.0");

      expect(response.status).toBe(400);
    });
  });

  describe("text search mode (?q=)", () => {
    it("returns text-search results in the same Place shape", async () => {
      mockMapbox([mapboxFeature("mbx.9", "Searched Diner", 41.5, -74.5, "9 Elm St")]);

      const { response, body } = await get("q=diner");

      expect(response.status).toBe(200);
      expect(body.places).toEqual([
        {
          mapbox_id: "mbx.9",
          name: "Searched Diner",
          address: "9 Elm St",
          latitude: 41.5,
          longitude: -74.5,
        },
      ]);
    });

    it("restricts the search to the food_and_drink category", async () => {
      const fetchMock = mockMapbox([]);

      await get("q=diner");

      const url = requestedUrl(fetchMock);
      expect(url.searchParams.get("q")).toBe("diner");
      expect(url.searchParams.get("poi_category")).toBe("food_and_drink");
    });

    it("drops results that cannot become a Place", async () => {
      mockMapbox([
        { properties: { mapbox_id: "mbx.2", name: "No Coords Cafe" } },
        mapboxFeature("mbx.3", "Good Cafe", 41.5, -74.5),
      ]);

      const { body } = await get("q=cafe");

      expect(body.places.map((p: { name: string }) => p.name)).toEqual([
        "Good Cafe",
      ]);
    });

    it("rejects a blank query", async () => {
      mockMapbox([]);

      const { response } = await get("q=%20");

      expect(response.status).toBe(400);
    });
  });

  it("returns 400 when neither mode's parameters are supplied", async () => {
    mockMapbox([]);

    const { response } = await get("");

    expect(response.status).toBe(400);
  });

  it("returns 500 when the Mapbox token is not configured", async () => {
    vi.stubEnv("MAPBOX_TOKEN", "");
    mockMapbox([]);

    const { response } = await get("lat=40.0&lon=-73.0");

    expect(response.status).toBe(500);
  });

  it("returns 502 when Mapbox fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );

    const { response } = await get("q=diner");

    expect(response.status).toBe(502);
  });
});
