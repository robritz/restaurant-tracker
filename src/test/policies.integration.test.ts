import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTwoHouseholds, serviceRoleClient, type Fixture } from "./households";

/**
 * The policies themselves, exercised as a signed-in member rather than
 * through a route.
 *
 * The route tests cover what a caller can see. These cover what a caller can
 * *do* -- the write-side guarantees of #34 (stories 14, 22 and 28), which no
 * route exercises because no route ever attempts them. They are the
 * assertions that would catch a policy loosened by accident.
 */
describe("Household policies (real database)", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("refuses an Entry written into another Household", async () => {
    // Story 14: ownership is not merely what the route writes, it is what
    // the database will accept. A forged household_id fails here rather
    // than succeeding quietly.
    const { error } = await fixture.a.client.from("entries").insert({
      household_id: fixture.b.id,
      place_id: fixture.sharedPlaceId,
      title: "forged",
      photo_path: "x.jpg",
      thumbnail_path: "x-thumb.webp",
      width: 1,
      height: 1,
      captured_at: new Date().toISOString(),
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/row-level security/i);
  });

  it("shows a Household none of the other's Entry rows", async () => {
    // Story 18: not just filtered from a response -- absent. This is what
    // makes a 404 honest rather than a polite refusal.
    const { data } = await fixture.a.client
      .from("entries")
      .select("id, title")
      .eq("place_id", fixture.sharedPlaceId);

    expect(data?.map((row) => row.title)).toEqual(["A's pizza"]);
  });

  it("lets a Household read a Place another recorded first", async () => {
    // The database half of story 21. Restaurant *search* itself goes to
    // Mapbox and never touches these rows; what matters here is that the
    // shared Place stays readable, so a repeat visit resolves to it rather
    // than duplicating it.
    const { data, error } = await fixture.a.client
      .from("places")
      .select("id")
      .eq("id", fixture.bOnlyPlaceId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.id).toBe(fixture.bOnlyPlaceId);
  });

  it("lets nobody rename a shared Place", async () => {
    // Story 22. There is no update policy, so RLS matches no rows rather
    // than raising -- the row is simply left alone, which is the guarantee.
    // Targets the B-only Place rather than the shared one so that a policy
    // loosened by accident fails this test alone, instead of cascading into
    // every later test that reads the shared Place's name.
    const { error } = await fixture.a.client
      .from("places")
      .update({ name: "Renamed By A" })
      .eq("id", fixture.bOnlyPlaceId);

    // No error and no change: the statement ran and matched nothing.
    expect(error).toBeNull();

    const { data } = await serviceRoleClient()
      .from("places")
      .select("name")
      .eq("id", fixture.bOnlyPlaceId)
      .single();

    expect(data?.name).toBe("B Only Cafe");
  });

  it("lets nobody delete a shared Place", async () => {
    const { error } = await fixture.a.client
      .from("places")
      .delete()
      .eq("id", fixture.emptyPlaceId);

    expect(error).toBeNull();

    const { count } = await serviceRoleClient()
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("id", fixture.emptyPlaceId);

    expect(count).toBe(1);
  });

  it("resolves an existing Place without disturbing it", async () => {
    // Exactly what POST /api/entries does on a repeat visit. An upsert here
    // would be ON CONFLICT DO UPDATE, which the missing update policy
    // refuses outright -- this is the reason that route cannot use one.
    const { error } = await fixture.a.client.from("places").upsert(
      {
        mapbox_id: fixture.sharedMapboxId,
        name: "Should Not Overwrite",
        address: "nowhere",
        latitude: 1,
        longitude: 1,
      },
      { onConflict: "mapbox_id", ignoreDuplicates: true },
    );

    expect(error).toBeNull();

    const { data } = await serviceRoleClient()
      .from("places")
      .select("name")
      .eq("id", fixture.sharedPlaceId)
      .single();
    expect(data?.name).toBe("Shared Diner");
  });

  it("refuses the upsert the route deliberately avoids", async () => {
    // The failure that would otherwise have surfaced only in production, on
    // every repeat visit to a known restaurant.
    const { error } = await fixture.a.client.from("places").upsert(
      {
        mapbox_id: fixture.sharedMapboxId,
        name: "Hijacked",
        address: "nowhere",
        latitude: 1,
        longitude: 1,
      },
      { onConflict: "mapbox_id" },
    );

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/row-level security/i);
  });

  it("shows a Household only its own membership", async () => {
    const { data } = await fixture.a.client.from("household_members").select("household_id");

    expect(data?.map((row) => row.household_id)).toEqual([fixture.a.id]);
  });
});
