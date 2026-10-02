import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHOTO_BUCKET } from "@/lib/photos";
import { serviceRoleClient, seedTwoHouseholds, type Fixture } from "./households";
import {
  planEntry,
  relocateEntry,
  storageAndEntryDeps,
} from "../../scripts/relocate-photos.mjs";

/**
 * #50 -- moving pre-Household photo objects under their Household prefix,
 * against a real bucket.
 *
 * The unit tests next to the script pin the order it does things in; what
 * they cannot show is that Supabase Storage behaves the way that order
 * assumes -- that `copy` leaves the original in place, that `list` can be
 * asked whether one object exists, and that the bytes of a dish are still
 * downloadable from the path its row now names. Those are the facts the whole
 * design rests on, and only a real stack can answer them.
 */
describe("relocate-photos (real bucket)", () => {
  const admin = serviceRoleClient();
  let fixture: Fixture;
  let entryId: string;
  let legacyPhoto: string;
  let legacyThumbnail: string;
  let keyedPhoto: string;
  let keyedThumbnail: string;

  // A 1x1 WebP, so the objects moved are real ones.
  const pixel = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();

    // An Entry as it looked before #37: no Household in either path. Inserted
    // rather than uploaded through the route, because the route cannot write
    // these paths any more -- which is the whole reason this script exists.
    const place = fixture.sharedPlaceId;
    const base = `${place}/${crypto.randomUUID()}`;
    legacyPhoto = `${base}.jpg`;
    legacyThumbnail = `${base}-thumb.webp`;
    keyedPhoto = `${fixture.a.id}/${legacyPhoto}`;
    keyedThumbnail = `${fixture.a.id}/${legacyThumbnail}`;

    for (const path of [legacyPhoto, legacyThumbnail]) {
      const { error } = await admin.storage
        .from(PHOTO_BUCKET)
        .upload(path, pixel, { contentType: "image/webp" });
      if (error) throw new Error(`seed legacy upload ${path}: ${error.message}`);
    }

    const { data, error } = await admin
      .from("entries")
      .insert({
        household_id: fixture.a.id,
        place_id: place,
        title: "A's pre-Household gelato",
        photo_path: legacyPhoto,
        thumbnail_path: legacyThumbnail,
        width: 800,
        height: 450,
        captured_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed legacy entry: ${error?.message}`);
    entryId = data.id;
  });

  afterAll(async () => {
    // The fixture only knows about the paths it created itself, so the four
    // this test may have left behind are its own to clear.
    await admin.storage
      .from(PHOTO_BUCKET)
      .remove([legacyPhoto, legacyThumbnail, keyedPhoto, keyedThumbnail]);
    await fixture?.cleanup();
  });

  async function storedPaths() {
    const { data, error } = await admin
      .from("entries")
      .select("photo_path, thumbnail_path")
      .eq("id", entryId)
      .single();
    if (error || !data) throw new Error(`read entry: ${error?.message}`);
    return data;
  }

  /**
   * The bytes, fetched the way the app's signed URL ultimately fetches them.
   * Downloading rather than signing on purpose: storage will sign a path with
   * nothing behind it, so a signature proves nothing about the object.
   */
  async function downloadable(path: string) {
    const { data, error } = await admin.storage
      .from(PHOTO_BUCKET)
      .download(path);
    return !error && (await data!.arrayBuffer()).byteLength > 0;
  }

  it("opens the dish before the move, from its pre-Household path", async () => {
    expect(await storedPaths()).toEqual({
      photo_path: legacyPhoto,
      thumbnail_path: legacyThumbnail,
    });
    expect(await downloadable(legacyPhoto)).toBe(true);
  });

  it("moves both objects, repoints the row, and leaves nothing behind", async () => {
    const deps = storageAndEntryDeps(admin);

    const result = await relocateEntry(
      deps,
      planEntry({
        id: entryId,
        household_id: fixture.a.id,
        photo_path: legacyPhoto,
        thumbnail_path: legacyThumbnail,
      }),
    );

    expect(result).toEqual({ entryId, copied: 2, repointed: true, removed: 2 });
    expect(await storedPaths()).toEqual({
      photo_path: keyedPhoto,
      thumbnail_path: keyedThumbnail,
    });
    // The dish still opens -- the same bytes, under the new path.
    expect(await downloadable(keyedPhoto)).toBe(true);
    expect(await downloadable(keyedThumbnail)).toBe(true);
    expect(await deps.exists(legacyPhoto)).toBe(false);
    expect(await deps.exists(legacyThumbnail)).toBe(false);
  });

  it("changes nothing when run again", async () => {
    const deps = storageAndEntryDeps(admin);
    const before = await storedPaths();

    const result = await relocateEntry(
      deps,
      planEntry({ id: entryId, household_id: fixture.a.id, ...before }),
    );

    expect(result).toEqual({ entryId, copied: 0, repointed: false, removed: 0 });
    expect(await storedPaths()).toEqual(before);
    expect(await downloadable(keyedPhoto)).toBe(true);
  });

  it("sweeps up an original left behind by an interrupted run", async () => {
    // Exactly the state a crash between the row update and the delete leaves:
    // the row is right, and the old object is still sitting there.
    const { error } = await admin.storage
      .from(PHOTO_BUCKET)
      .upload(legacyPhoto, pixel, { contentType: "image/webp" });
    expect(error).toBeNull();

    const deps = storageAndEntryDeps(admin);
    const result = await relocateEntry(
      deps,
      planEntry({ id: entryId, household_id: fixture.a.id, ...(await storedPaths()) }),
    );

    expect(result).toEqual({ entryId, copied: 0, repointed: false, removed: 1 });
    expect(await deps.exists(legacyPhoto)).toBe(false);
    // And the dish is untouched by the sweep.
    expect(await downloadable(keyedPhoto)).toBe(true);
  });
});
