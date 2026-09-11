import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}));

import { GET } from "./route";

const DINER = {
  id: "place-uuid-1",
  name: "Test Diner",
  address: "123 Main St",
  latitude: 40.0,
  longitude: -73.0,
};

const CAFE = {
  id: "place-uuid-2",
  name: "Corner Cafe",
  address: "9 Side St",
  latitude: 41.0,
  longitude: -74.0,
};

type PlaceRow = typeof DINER & { entries: { captured_at: string }[] };

/**
 * Shapes the nested select the route uses: each Place carries the
 * captured-at of its Entries, which is where the dish count and
 * last-visited date come from.
 */
function stubSupabase(rows: PlaceRow[] | null, error: unknown = null) {
  const order = vi.fn().mockResolvedValue({ data: rows, error });
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  createSupabaseServiceRoleClient.mockReturnValue({ from });
  return { from, select, order };
}

async function get() {
  const response = await GET();
  return { response, body: await response.json() };
}

describe("GET /api/place-logs", () => {
  beforeEach(() => {
    createSupabaseServiceRoleClient.mockReset();
  });

  it("returns a pin for each Place with its coordinates", async () => {
    stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
    ]);

    const { response, body } = await get();

    expect(response.status).toBe(200);
    expect(body.placeLogs).toEqual([
      {
        id: "place-uuid-1",
        name: "Test Diner",
        address: "123 Main St",
        latitude: 40.0,
        longitude: -73.0,
        entry_count: 1,
        last_captured_at: "2026-01-01T12:00:00.000Z",
      },
    ]);
  });

  it("counts the Entries at each Place and reports the most recent", async () => {
    stubSupabase([
      {
        ...DINER,
        entries: [
          { captured_at: "2026-01-01T12:00:00.000Z" },
          { captured_at: "2026-03-04T19:00:00.000Z" },
          { captured_at: "2026-02-02T12:00:00.000Z" },
        ],
      },
    ]);

    const { body } = await get();

    expect(body.placeLogs[0]).toMatchObject({
      entry_count: 3,
      last_captured_at: "2026-03-04T19:00:00.000Z",
    });
  });

  it("excludes a Place that has no Entries", async () => {
    // A failed Entry save leaves its Place behind deliberately, since Places
    // are shared -- so a Place with no Entries can exist and must not pin.
    stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
      { ...CAFE, entries: [] },
    ]);

    const { body } = await get();

    expect(body.placeLogs.map((log: { name: string }) => log.name)).toEqual([
      "Test Diner",
    ]);
  });

  it("orders Places by most recent visit first", async () => {
    stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
      { ...CAFE, entries: [{ captured_at: "2026-05-05T12:00:00.000Z" }] },
    ]);

    const { body } = await get();

    expect(body.placeLogs.map((log: { name: string }) => log.name)).toEqual([
      "Corner Cafe",
      "Test Diner",
    ]);
  });

  it("returns no signed photo URLs", async () => {
    stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
    ]);

    const { body } = await get();

    expect(JSON.stringify(body)).not.toContain("token");
    expect(Object.keys(body.placeLogs[0])).not.toContain("thumbnail_url");
  });

  it("returns an empty list when nothing has been logged", async () => {
    stubSupabase([]);

    const { response, body } = await get();

    expect(response.status).toBe(200);
    expect(body.placeLogs).toEqual([]);
  });

  it("fails loudly when the query fails", async () => {
    stubSupabase(null, { message: "connection lost" });

    const { response } = await get();

    expect(response.status).toBe(500);
  });
});
