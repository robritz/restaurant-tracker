import { beforeEach, describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  // The real NO_HOUSEHOLD_MESSAGE, so a test asserting the copy cannot pass
  // against a stale duplicate of it.
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { GET } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

const HOUSEHOLD_ID = "household-uuid-1";

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
 * most recent captured-at come from.
 */
function stubSupabase(rows: PlaceRow[] | null, error: unknown = null) {
  const select = vi.fn().mockResolvedValue({ data: rows, error });
  const from = vi.fn().mockReturnValue({ select });
  requireHousehold.mockResolvedValue({ supabase: { from }, householdId: HOUSEHOLD_ID });
  return { from, select };
}

async function get() {
  const response = await GET();
  return { response, body: await response.json() };
}

describe("GET /api/place-logs", () => {
  beforeEach(() => {
    requireHousehold.mockReset();
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

  it("excludes a Place that has no Entries in the query itself", async () => {
    // A failed Entry save leaves its Place behind deliberately, since Places
    // are shared -- so a Place with no Entries can exist and must not pin.
    // An inner join keeps it out of the result set entirely, rather than
    // relying on a filter here that a later refactor could drop.
    const supabase = stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
    ]);

    await get();

    expect(supabase.select.mock.calls[0][0]).toContain("entries!inner");
  });

  it("reads as the caller, so the join only sees our Household's Entries", async () => {
    // These two facts together are story 15. The route names no household_id
    // -- RLS narrows `entries` before the inner join runs, so a Place where
    // only another family has eaten has no visible Entries and drops out of
    // the result set on its own.
    const supabase = stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
    ]);

    await get();

    expect(requireHousehold).toHaveBeenCalled();
    expect(supabase.select.mock.calls[0][0]).toContain("entries!inner");
  });

  it("counts only the Entries the caller can see", async () => {
    // A shared Place where we have eaten once and another Household has
    // eaten ten times is a Pin reading 1, not 11. RLS has already dropped
    // their rows by the time the count happens, so the Pin cannot report a
    // number that would tell us they were there at all (stories 17 and 18).
    stubSupabase([
      { ...DINER, entries: [{ captured_at: "2026-01-01T12:00:00.000Z" }] },
    ]);

    const { body } = await get();

    expect(body.placeLogs[0].entry_count).toBe(1);
  });

  it("orders Places by most recently captured first", async () => {
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

  it("fails loudly when the credential belongs to no Household", async () => {
    // Not an empty list. An empty map is what "you have logged nothing yet"
    // looks like, and a provisioning fault wearing that appearance reads as
    // lost data.
    stubSupabase([]);
    requireHousehold.mockResolvedValue(null);

    const { response, body } = await get();

    expect(response.status).toBe(500);
    expect(body.error).toBe(NO_HOUSEHOLD_MESSAGE);
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
