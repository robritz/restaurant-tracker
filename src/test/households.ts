import {
  createSupabaseClient,
  createSupabaseServiceRoleClient,
  type SupabaseDataClient,
} from "@/lib/supabase/client";
import { PHOTO_BUCKET } from "@/lib/photos";
import { MAX_PLACE_LOG_ENTRIES } from "@/lib/place-logs";

/**
 * Two Households, a restaurant they have both eaten at, and one only the
 * second has -- built in a real database so the RLS policies are the thing
 * under test.
 *
 * The route tests elsewhere mock the Supabase client, which pins how a route
 * is wired but would keep passing if every policy were dropped tomorrow. The
 * boundary these helpers set up is the part that cannot be mocked: it either
 * holds in Postgres or it does not.
 */

/**
 * A seeded Household *and* a way to act as one of its members. Named for the
 * actor rather than the domain concept: CONTEXT.md reserves "Household" for
 * the family itself, which has no client and no test dishes hanging off it.
 */
export type SeededHousehold = {
  id: string;
  /**
   * Signed in as a member, so every query made with it is subject to exactly
   * the policies a real request would meet.
   */
  client: SupabaseDataClient;
  /** Entry ids by dish title; titles are unique within a fixture. */
  entryIds: Record<string, string>;
};

export type Fixture = {
  a: SeededHousehold;
  b: SeededHousehold;
  /** A Place both Households have eaten at. */
  sharedPlaceId: string;
  /** Its dedup key, for tests that need to collide with it deliberately. */
  sharedMapboxId: string;
  /** A Place only Household B has eaten at. */
  bOnlyPlaceId: string;
  /** A Place with no Entries at all -- the residue of a failed save. */
  emptyPlaceId: string;
  /**
   * A Place where the other Household has more Entries than one PlaceLog
   * will return, and this one has a handful. Exists so the cap and the
   * ownership filter can be observed interacting: a cap applied before the
   * filter would truncate against the wrong rows.
   */
  busyPlaceId: string;
  /**
   * The timestamp a seeded dish was given, so a test can assert the exact
   * date a response should carry rather than merely that two differ.
   */
  capturedAt: (title: string) => string;
  cleanup: () => Promise<void>;
};

/**
 * The app's own service-role client, not a copy of it. An earlier version of
 * this fixture rebuilt it inline and dropped `normalizeSupabaseUrl()`, which
 * exists because `supabase status` prints API_URL next to REST_URL and the
 * wrong one fails as an opaque PGRST125. Going through the real helper means
 * the fixture cannot drift from what the routes actually do.
 */
export function serviceRoleClient(): SupabaseDataClient {
  return createSupabaseServiceRoleClient();
}

/**
 * A 1x1 WebP, uploaded for every Entry the fixture creates. Storage signs
 * only objects that exist, so a PlaceLog built on paths with nothing behind
 * them would fail for a reason that has nothing to do with ownership.
 */
const PIXEL = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64",
);

/**
 * `daysAgo` is explicit rather than derived from position: the tests compare
 * one Household's most recent visit against the other's, so two Entries
 * accidentally sharing a timestamp would make that comparison vacuous.
 */
type SeedEntry = {
  placeId: string;
  title: string;
  daysAgo: number;
  /**
   * Whether to upload objects for this Entry. Storage signs only objects
   * that exist, so an Entry that a test expects to *see* needs them -- and
   * one seeded purely as another Household's bulk, which must never be
   * returned, does not. Skipping those keeps the cap fixture from doing a
   * hundred uploads to assert one number.
   */
  withPhoto?: boolean;
};

export async function seedTwoHouseholds(): Promise<Fixture> {
  const admin = serviceRoleClient();
  // Date.now() alone is both the uniqueness key and the clock, so two
  // fixtures built in the same millisecond would collide on mapbox_id -- and
  // the loser's cleanup would sweep the winner's Places. The suffix makes the
  // key unique without disturbing the timestamps derived from `run`.
  const run = Date.now();
  const tag = `${run}-${Math.random().toString(36).slice(2, 8)}`;
  const created = { users: [] as string[], households: [] as string[], paths: [] as string[] };
  const capturedAtByTitle = new Map<string, string>();

  const mapboxId = (slug: string) => `test.${tag}.${slug}`;

  async function makePlace(slug: string, name: string): Promise<string> {
    const { data, error } = await admin
      .from("places")
      .insert({
        mapbox_id: mapboxId(slug),
        name,
        address: `${slug} Street`,
        latitude: 40,
        longitude: -73,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed place ${slug}: ${error?.message}`);
    return data.id;
  }

  async function makeHousehold(label: string, entries: SeedEntry[]): Promise<SeededHousehold> {
    const email = `${label}.${run}@households.test`;
    const password = `pw-${run}-${label}`;

    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userError || !user.user) throw new Error(`seed user ${label}: ${userError?.message}`);
    created.users.push(user.user.id);

    const { data: household, error: householdError } = await admin
      .from("households")
      .insert({ name: `Household ${label.toUpperCase()}` })
      .select("id")
      .single();
    if (householdError || !household) {
      throw new Error(`seed household ${label}: ${householdError?.message}`);
    }
    created.households.push(household.id);

    const { error: memberError } = await admin
      .from("household_members")
      .insert({ household_id: household.id, user_id: user.user.id });
    if (memberError) throw new Error(`seed membership ${label}: ${memberError.message}`);

    const entryIds: Record<string, string> = {};
    for (const entry of entries) {
      const base = `${household.id}/${entry.placeId}/${crypto.randomUUID()}`;
      const photoPath = `${base}.jpg`;
      const thumbnailPath = `${base}-thumb.webp`;

      if (entry.withPhoto ?? true) {
        for (const path of [photoPath, thumbnailPath]) {
          const { error } = await admin.storage
            .from(PHOTO_BUCKET)
            .upload(path, PIXEL, { contentType: "image/webp" });
          if (error) throw new Error(`seed upload ${path}: ${error.message}`);
          created.paths.push(path);
        }
      }

      const capturedAt = new Date(run - entry.daysAgo * 86_400_000).toISOString();
      capturedAtByTitle.set(entry.title, capturedAt);

      const { data: row, error: entryError } = await admin
        .from("entries")
        .insert({
          household_id: household.id,
          place_id: entry.placeId,
          title: entry.title,
          photo_path: photoPath,
          thumbnail_path: thumbnailPath,
          width: 800,
          height: 450,
          captured_at: capturedAt,
        })
        .select("id")
        .single();
      if (entryError || !row) throw new Error(`seed entry ${entry.title}: ${entryError?.message}`);
      entryIds[entry.title] = row.id;
    }

    // A real session, so the client below carries a real access token and
    // meets the policies exactly as a browser would.
    const client = createSupabaseClient();
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);

    return { id: household.id, client, entryIds };
  }

  async function cleanup() {
    if (created.paths.length) {
      await admin.storage.from(PHOTO_BUCKET).remove(created.paths);
    }
    if (created.households.length) {
      await admin.from("entries").delete().in("household_id", created.households);
      await admin.from("household_members").delete().in("household_id", created.households);
      await admin.from("households").delete().in("id", created.households);
    }
    // By dedup key rather than by id, so a Place a test created by colliding
    // with one of these is swept up too.
    await admin.from("places").delete().like("mapbox_id", `test.${tag}.%`);
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
  }

  // Seeding creates auth users, Households and storage objects one at a
  // time. If a later step throws, the caller never receives a fixture and so
  // can never call cleanup() -- the rows would outlive the run, and the
  // mapbox_id sweep would not reach the users or objects. Cleaning up here
  // and rethrowing is what keeps a failed seed from poisoning the next run.
  let sharedPlaceId: string;
  let bOnlyPlaceId: string;
  let emptyPlaceId: string;
  let busyPlaceId: string;
  let a: SeededHousehold;
  let b: SeededHousehold;

  try {
    sharedPlaceId = await makePlace("shared", "Shared Diner");
    bOnlyPlaceId = await makePlace("bonly", "B Only Cafe");
    emptyPlaceId = await makePlace("empty", "Nobody Ate Here");
    busyPlaceId = await makePlace("busy", "Busy Canteen");

    // Distinct days throughout, so "whose most recent visit is this?" and
    // "which dish is newest?" both have unambiguous answers.
    a = await makeHousehold("a", [
      { placeId: sharedPlaceId, title: "A's pizza", daysAgo: 3 },
      { placeId: busyPlaceId, title: "A's soup", daysAgo: 2 },
      { placeId: busyPlaceId, title: "A's bread", daysAgo: 8 },
    ]);
    b = await makeHousehold("b", [
      { placeId: sharedPlaceId, title: "B's ramen", daysAgo: 1 },
      { placeId: sharedPlaceId, title: "B's gelato", daysAgo: 9 },
      { placeId: bOnlyPlaceId, title: "B's croissant", daysAgo: 5 },
      // More than a PlaceLog will return, so the cap is certainly in play.
      // No photo objects: these must never be returned, and uploading a
      // hundred files to assert one number would be waste.
      ...Array.from({ length: MAX_PLACE_LOG_ENTRIES + 5 }, (_, i) => ({
        placeId: busyPlaceId,
        title: `B's bulk dish ${i}`,
        daysAgo: i,
        withPhoto: false,
      })),
    ]);
  } catch (error) {
    await cleanup();
    throw error;
  }


  return {
    a,
    b,
    sharedPlaceId,
    sharedMapboxId: mapboxId("shared"),
    bOnlyPlaceId,
    emptyPlaceId,
    busyPlaceId,
    capturedAt: (title) => {
      const value = capturedAtByTitle.get(title);
      if (!value) throw new Error(`No seeded dish titled "${title}".`);
      // PostgREST renders timestamptz with a +00:00 offset rather than the
      // trailing Z that toISOString() produces; compare like for like.
      return value.replace(/\.(\d{3})Z$/, ".$1+00:00");
    },
    cleanup,
  };
}
