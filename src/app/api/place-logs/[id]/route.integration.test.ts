import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { GET } from "./route";
import { seedTwoHouseholds, type Fixture } from "@/test/households";

/**
 * #39 -- a PlaceLog lists only your Household's dishes.
 *
 * A PlaceLog is Household-relative: the same Place read by two Households is
 * two different PlaceLogs, and a Place you have no Entries at is not a
 * PlaceLog at all. Only a real database with two Households can show that.
 */
describe("GET /api/place-logs/[id] (two Households, real database)", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function placeLogFor(household: "a" | "b", placeId: string) {
    const { id, client } = fixture[household];
    requireHousehold.mockResolvedValue({ supabase: client, householdId: id });
    const response = await GET(new Request(`http://test/api/place-logs/${placeId}`), {
      params: Promise.resolve({ id: placeId }),
    });
    return { response, body: await response.json() };
  }

  it("lists only your own dishes at a Place two Households share", async () => {
    const { response, body } = await placeLogFor("a", fixture.sharedPlaceId);

    expect(response.status).toBe(200);
    expect(body.placeLog.entries.map((e: { title: string }) => e.title)).toEqual([
      "A's pizza",
    ]);
  });

  it("shows the other Household a different PlaceLog at the same Place", async () => {
    // Same Place row, same id, two genuinely different answers to "what have
    // we eaten here?".
    const { body } = await placeLogFor("b", fixture.sharedPlaceId);

    const titles = body.placeLog.entries.map((e: { title: string }) => e.title);
    expect(titles).toContain("B's ramen");
    expect(titles).not.toContain("A's pizza");
  });

  it("leaks no dish title, id or thumbnail belonging to the other Household", async () => {
    // Asserted against the whole serialised response rather than the parsed
    // entries: a leak that arrived through some field nobody thought to
    // check would still be caught here.
    const { body } = await placeLogFor("a", fixture.sharedPlaceId);
    const raw = JSON.stringify(body);

    expect(raw).not.toContain("B's ramen");
    expect(raw).not.toContain("B's gelato");
    for (const entryId of Object.values(fixture.b.entryIds)) {
      expect(raw).not.toContain(entryId);
    }
    // Photo paths lead with the Household, so the other Household's id
    // appearing anywhere in a signed URL would mean a borrowed thumbnail.
    expect(raw).not.toContain(fixture.b.id);
  });

  it("404s on a Place where only the other Household has eaten", async () => {
    // Not an empty PlaceLog: an empty dish list would still confirm the
    // Place is in the system on somebody's behalf.
    const { response, body } = await placeLogFor("a", fixture.bOnlyPlaceId);

    expect(response.status).toBe(404);
    expect(body.error).toBe("No place log found.");
    expect(body.placeLog).toBeUndefined();
  });

  it("404s on a Place nobody has eaten at", async () => {
    const { response } = await placeLogFor("a", fixture.emptyPlaceId);

    expect(response.status).toBe(404);
  });

  it("orders your own dishes newest first", async () => {
    // B's ramen is a day old and the gelato nine, so ordering is visible
    // only if it is applied to B's own Entries.
    const { body } = await placeLogFor("b", fixture.sharedPlaceId);

    expect(body.placeLog.entries.map((e: { title: string }) => e.title)).toEqual([
      "B's ramen",
      "B's gelato",
    ]);
  });

  it("caps against your own dishes, not against everyone's", async () => {
    // The Place where the other Household has more Entries than one PlaceLog
    // returns. The query caps the joined Entries, so if the cap were applied
    // before ownership narrowed them, A's two dishes could be crowded out
    // entirely by rows A is not allowed to see -- an empty gallery at a
    // restaurant A has eaten at twice.
    const { response, body } = await placeLogFor("a", fixture.busyPlaceId);

    expect(response.status).toBe(200);
    expect(body.placeLog.entries.map((e: { title: string }) => e.title)).toEqual([
      "A's soup",
      "A's bread",
    ]);
  });

  it("signs a thumbnail for every dish it returns", async () => {
    const { body } = await placeLogFor("b", fixture.sharedPlaceId);

    for (const entry of body.placeLog.entries) {
      expect(entry.thumbnail_url).toContain("token=");
    }
  });
});
