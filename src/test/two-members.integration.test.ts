import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { GET as placeLogs } from "@/app/api/place-logs/route";
import { GET as placeLog } from "@/app/api/place-logs/[id]/route";
import { GET as entryPhoto } from "@/app/api/entries/[id]/photo/route";
import {
  createCredential,
  seedTwoHouseholds,
  serviceRoleClient,
  type Credential,
  type Fixture,
} from "./households";
import { hashInviteToken, newInviteToken } from "@/lib/invites/token";
import type { PlaceLogSummary } from "@/app/api/place-logs/route";

/**
 * #49, acceptance criterion 2: both credentials see the same map, the same
 * PlaceLogs, and the same dish photos.
 *
 * The policy-level tests in invites.integration.test.ts show a second member
 * reading the same `entries` rows. This asks the question the criterion
 * actually asks -- through the routes the phone really calls, as a member who
 * joined by redeeming an invite rather than one the fixture seeded.
 *
 * Only `requireHousehold` is stubbed, to hand back a genuinely signed-in
 * client. Everything past that seam is real.
 */
describe("a Household with two phones in it (real database)", () => {
  let fixture: Fixture;
  let second: Credential;

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();

    // Joined the way a real second phone does: an invite, redeemed.
    second = await createCredential("second-phone");
    const token = newInviteToken();
    const { error } = await serviceRoleClient().from("household_invites").insert({
      household_id: fixture.a.id,
      token_hash: hashInviteToken(token),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    if (error) throw new Error(`seed invite: ${error.message}`);

    const { data } = await second.client.rpc("accept_household_invite", {
      p_token_hash: hashInviteToken(token),
    });
    expect(data).toBe(fixture.a.id);
  });

  afterAll(async () => {
    await second?.remove();
    await fixture?.cleanup();
  });

  /** The same route call, made as either phone in Household A. */
  function as(phone: "first" | "second") {
    const client = phone === "first" ? fixture.a.client : second.client;
    requireHousehold.mockResolvedValue({ supabase: client, householdId: fixture.a.id });
  }

  it("draws both phones the same map", async () => {
    as("first");
    const mine: PlaceLogSummary[] = (await (await placeLogs()).json()).placeLogs;
    as("second");
    const theirs: PlaceLogSummary[] = (await (await placeLogs()).json()).placeLogs;

    expect(theirs).toEqual(mine);
    expect(theirs.length).toBeGreaterThan(0);
  });

  it("shows both phones the same dishes at a Place", async () => {
    const params = Promise.resolve({ id: fixture.sharedPlaceId });

    as("first");
    const mine = await (await placeLog(new Request("http://x"), { params })).json();
    as("second");
    const theirs = await (
      await placeLog(new Request("http://x"), { params: Promise.resolve({ id: fixture.sharedPlaceId }) })
    ).json();

    expect(theirs.placeLog.entries.map((e: { title: string }) => e.title)).toEqual(
      mine.placeLog.entries.map((e: { title: string }) => e.title),
    );
    expect(theirs.placeLog.entries.length).toBeGreaterThan(0);
  });

  it("signs a photo URL for a dish the other phone recorded", async () => {
    // The strongest form of "the same dish photos": an Entry the first phone
    // saved, fetched by the second.
    const entryId = fixture.a.entryIds["A's pizza"]!;

    as("second");
    const response = await entryPhoto(new Request("http://x"), {
      params: Promise.resolve({ id: entryId }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).url).toContain("token=");
  });

  it("still refuses the second phone a photo from the other Household", async () => {
    // More members must not mean a wider view.
    const entryId = fixture.b.entryIds["B's croissant"]!;

    as("second");
    const response = await entryPhoto(new Request("http://x"), {
      params: Promise.resolve({ id: entryId }),
    });

    expect(response.status).toBe(404);
  });

  it("still gives neither phone a Pin for the other Household's Place", async () => {
    for (const phone of ["first", "second"] as const) {
      as(phone);
      const { placeLogs: pins } = await (await placeLogs()).json();
      expect(pins.map((p: PlaceLogSummary) => p.id)).not.toContain(fixture.bOnlyPlaceId);
    }
  });
});
