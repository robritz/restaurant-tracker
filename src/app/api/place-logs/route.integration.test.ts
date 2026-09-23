import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { GET } from "./route";
import { seedTwoHouseholds, type Fixture } from "@/test/households";
import type { PlaceLogSummary } from "./route";
import { MAX_PLACE_LOG_ENTRIES } from "@/lib/place-logs";

/**
 * #38 -- the map shows only your Household's Places.
 *
 * The unit tests beside this file mock the Supabase client, so they pin how
 * the route is wired but would keep passing if the policy on `entries` were
 * dropped. These run the real route against a real database with two
 * Households, which is the only way the boundary is actually asserted.
 *
 * Only `requireHousehold` is stubbed, and only to hand back a genuinely
 * signed-in client -- the seam the route already uses. Everything past it,
 * including every policy, is real.
 */
describe("GET /api/place-logs (two Households, real database)", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function mapFor(household: "a" | "b"): Promise<PlaceLogSummary[]> {
    const { id, client } = fixture[household];
    requireHousehold.mockResolvedValue({ supabase: client, householdId: id });
    const response = await GET();
    expect(response.status).toBe(200);
    return (await response.json()).placeLogs;
  }

  it("gives a Household no Pin for a Place only the other has eaten at", async () => {
    // The riskiest line in the whole spec. B has eaten at a cafe A has never
    // been to; Places are shared, so the row is readable by A. It must still
    // produce no Pin, because A has no Entries there.
    const summaries = await mapFor("a");

    expect(summaries.map((summary) => summary.id)).not.toContain(fixture.bOnlyPlaceId);
  });

  it("gives each Household exactly one Pin for a Place they have both used", async () => {
    const aEntries = (await mapFor("a")).filter((s) => s.id === fixture.sharedPlaceId);
    const bEntries = (await mapFor("b")).filter((s) => s.id === fixture.sharedPlaceId);

    expect(aEntries).toHaveLength(1);
    expect(bEntries).toHaveLength(1);
  });

  it("counts only your own dishes at a shared Place", async () => {
    // A ate once at the shared Place, B twice. A Pin reading 3 would be
    // telling A that somebody else has been there.
    const aShared = (await mapFor("a")).find((s) => s.id === fixture.sharedPlaceId);
    const bShared = (await mapFor("b")).find((s) => s.id === fixture.sharedPlaceId);

    expect(aShared?.entry_count).toBe(1);
    expect(bShared?.entry_count).toBe(2);
  });

  it("dates a shared Place from your own most recent visit", async () => {
    // Pinned to each Household's *own* newest Entry, not merely asserted to
    // differ: two wrong-but-different dates would satisfy a `not.toBe`, and
    // borrowing the other Household's date is exactly the bug in question.
    const aShared = (await mapFor("a")).find((s) => s.id === fixture.sharedPlaceId);
    const bShared = (await mapFor("b")).find((s) => s.id === fixture.sharedPlaceId);

    expect(aShared?.last_captured_at).toBe(fixture.capturedAt("A's pizza"));
    expect(bShared?.last_captured_at).toBe(fixture.capturedAt("B's ramen"));
  });

  it("orders Places by your own most recent visit, newest first", async () => {
    // B ate at the shared Place yesterday and the cafe five days ago, so a
    // correct ordering is unambiguous -- and is an ordering of B's Entries,
    // not of anyone's.
    const order = (await mapFor("b")).map((summary) => summary.id);

    expect(order.indexOf(fixture.sharedPlaceId)).toBeLessThan(
      order.indexOf(fixture.bOnlyPlaceId),
    );
  });

  it("counts the other Household's many dishes as none of yours", async () => {
    // The same Place the cap test uses: the other Household has more Entries
    // there than a PlaceLog returns, and this Household has two. The summary
    // carries no signed URLs, so it is the cheap place to confirm that bulk
    // really exists -- and that none of it is counted here.
    const aBusy = (await mapFor("a")).find((s) => s.id === fixture.busyPlaceId);
    const bBusy = (await mapFor("b")).find((s) => s.id === fixture.busyPlaceId);

    expect(aBusy?.entry_count).toBe(2);
    expect(bBusy?.entry_count).toBeGreaterThan(MAX_PLACE_LOG_ENTRIES);
  });

  it("never pins a Place nobody has eaten at", async () => {
    // The residue of a failed save: a Place exists, no Entry references it.
    const summaries = await mapFor("a");

    expect(summaries.map((summary) => summary.id)).not.toContain(fixture.emptyPlaceId);
  });

  it("shows a Household every Place it has eaten at, and no others", async () => {
    const bPlaceIds = (await mapFor("b")).map((summary) => summary.id);

    expect(bPlaceIds).toContain(fixture.sharedPlaceId);
    expect(bPlaceIds).toContain(fixture.bOnlyPlaceId);
    expect(bPlaceIds).not.toContain(fixture.emptyPlaceId);
  });
});
