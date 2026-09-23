import { NextResponse } from "next/server";
import sharp from "sharp";
import { createSupabaseServiceRoleClient, type SupabaseDataClient } from "@/lib/supabase/client";
import { requireHousehold, NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";
import { PHOTO_BUCKET } from "@/lib/photos";
import type { Place } from "@/app/api/places/route";


// Big enough to look sharp in the gallery, small enough that a place with a
// dozen dishes isn't tens of megabytes over mobile data.
const THUMBNAIL_MAX_EDGE = 800;

/** A saved Entry: one photo, one dish title, one Place, one captured-at. */
export type Entry = {
  id: string;
  title: string;
  photo_path: string;
  thumbnail_path: string;
  width: number;
  height: number;
  captured_at: string;
  created_at: string;
  place: Place & { id: string };
};

type EntryInput = {
  title: string;
  capturedAt: string;
  place: Place;
  photo: File;
};

class InvalidEntryError extends Error {}

function requireText(form: FormData, field: string): string {
  const value = form.get(field);
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidEntryError(`'${field}' is required.`);
  }
  return value.trim();
}

function requireNumber(form: FormData, field: string): number {
  const value = Number(requireText(form, field));
  if (Number.isNaN(value)) {
    throw new InvalidEntryError(`'${field}' must be a number.`);
  }
  return value;
}

function parseEntryInput(form: FormData): EntryInput {
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    throw new InvalidEntryError("'photo' is required.");
  }

  const capturedAt = requireText(form, "captured_at");
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new InvalidEntryError("'captured_at' must be an ISO date string.");
  }

  return {
    title: requireText(form, "title"),
    capturedAt,
    place: {
      mapbox_id: requireText(form, "mapbox_id"),
      name: requireText(form, "name"),
      address: requireText(form, "address"),
      latitude: requireNumber(form, "latitude"),
      longitude: requireNumber(form, "longitude"),
    },
    photo,
  };
}

/**
 * The original and its thumbnail share a name, so the pair is obvious when
 * looking at the bucket.
 *
 * Household first, then Place. Leading with the Household means everything
 * one family has ever uploaded sits under a single prefix, so removing their
 * data later is a prefix delete rather than a migration that has to join
 * through `entries` to work out which objects were theirs. The bucket is
 * private and these paths are never guessed at -- a signed URL is the only
 * way in -- so the prefix is for operators, not for access control.
 */
function photoPaths(
  householdId: string,
  placeId: string,
  photo: File,
): { original: string; thumbnail: string } {
  const extension = photo.name.includes(".")
    ? photo.name.split(".").pop()!.toLowerCase()
    : "jpg";
  const base = `${householdId}/${placeId}/${crypto.randomUUID()}`;
  return { original: `${base}.${extension}`, thumbnail: `${base}-thumb.webp` };
}

type Thumbnail = { body: Buffer; width: number; height: number };

/**
 * The gallery-sized copy of a photo. The dimensions returned are the
 * *upright* ones, which is what the gallery reserves tile height from.
 */
async function createThumbnail(photo: File): Promise<Thumbnail> {
  const { data, info } = await sharp(
    Buffer.from(await photo.arrayBuffer()),
  )
    // No argument: apply whatever the EXIF orientation says, so a photo shot
    // in portrait is stored upright instead of sideways.
    .rotate()
    .resize({
      width: THUMBNAIL_MAX_EDGE,
      height: THUMBNAIL_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp()
    .toBuffer({ resolveWithObject: true });

  return { body: data, width: info.width, height: info.height };
}

type StoredPlace = Place & { id: string };

/**
 * The shared Place for this Entry, creating it the first time anyone records
 * a meal there.
 *
 * Not an upsert, which is what this was before Households existed. An upsert
 * UPDATEs on conflict, and `places` grants update to nobody: a Place is
 * shared, so rewriting its name and address would change it under every other
 * Household's Pins (issue #34, story 22). `ignoreDuplicates` makes this
 * ON CONFLICT DO NOTHING, so a restaurant another family recorded first is
 * left exactly as they recorded it -- and found, rather than duplicated
 * (docs/adr/0001-shared-deduped-place.md).
 */
async function resolvePlace(
  supabase: SupabaseDataClient,
  place: Place,
): Promise<StoredPlace | null> {
  const { error: insertError } = await supabase
    .from("places")
    .upsert(place, { onConflict: "mapbox_id", ignoreDuplicates: true });

  if (insertError) return null;

  // Read back rather than returning the insert's own row: DO NOTHING returns
  // no row on conflict, and re-reading is the one branch that answers both
  // the "we just created it" and the "it was already there" case.
  const { data, error } = await supabase
    .from("places")
    .select()
    .eq("mapbox_id", place.mapbox_id)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function POST(request: Request) {
  let input: EntryInput;
  try {
    input = parseEntryInput(await request.formData());
  } catch (error) {
    if (error instanceof InvalidEntryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // Before anything is written: an unreadable image is the caller's fault,
  // and finding that out now avoids a Place and an upload for an Entry that
  // can never be completed.
  let thumbnail: Thumbnail;
  try {
    thumbnail = await createThumbnail(input.photo);
  } catch {
    return NextResponse.json(
      { error: "'photo' must be a readable image." },
      { status: 400 },
    );
  }

  // The middleware has already turned away anyone without a session, so the
  // only way this is null is a half-provisioned database -- hence 500 rather
  // than 403, and before the bucket is touched, so a failure here cannot
  // strand photos with no Entry to reference them.
  const household = await requireHousehold();
  if (!household) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 500 });
  }
  const { supabase, householdId } = household;

  const place = await resolvePlace(supabase, input.place);
  if (!place) {
    return NextResponse.json(
      { error: "Unable to save the place for this entry." },
      { status: 500 },
    );
  }

  // The service role, for the bucket only: it has no policies and is kept
  // private by never handing out its key
  // (docs/adr/0005-service-role-for-storage-only.md). The Entry row that
  // makes these photos reachable is still written under RLS below.
  const storage = createSupabaseServiceRoleClient();

  const paths = photoPaths(householdId, place.id, input.photo);
  const { error: uploadError } = await storage.storage
    .from(PHOTO_BUCKET)
    .upload(paths.original, input.photo, { contentType: input.photo.type });

  if (uploadError) {
    return NextResponse.json(
      { error: "Unable to upload the photo for this entry." },
      { status: 500 },
    );
  }

  const { error: thumbnailError } = await storage.storage
    .from(PHOTO_BUCKET)
    .upload(paths.thumbnail, thumbnail.body, { contentType: "image/webp" });

  if (thumbnailError) {
    await storage.storage.from(PHOTO_BUCKET).remove([paths.original]);
    return NextResponse.json(
      { error: "Unable to upload the photo for this entry." },
      { status: 500 },
    );
  }

  const { data: entry, error: entryError } = await supabase
    .from("entries")
    .insert({
      // What makes this dish ours rather than whichever phone uploaded it
      // (issue #34, story 14). The insert policy re-checks it against the
      // caller's memberships, so a forged household_id is rejected by the
      // database, not merely unwritten by this line.
      household_id: householdId,
      place_id: place.id,
      title: input.title,
      photo_path: paths.original,
      thumbnail_path: paths.thumbnail,
      width: thumbnail.width,
      height: thumbnail.height,
      captured_at: input.capturedAt,
    })
    .select()
    .single();

  if (entryError || !entry) {
    // Don't leave the photos behind for an Entry that was never created. The
    // place row stays -- it's shared, so other Entries may reference it.
    await storage.storage
      .from(PHOTO_BUCKET)
      .remove([paths.original, paths.thumbnail]);
    return NextResponse.json(
      { error: "Unable to save this entry." },
      { status: 500 },
    );
  }

  const created: Entry = {
    id: entry.id,
    title: entry.title,
    photo_path: entry.photo_path,
    thumbnail_path: entry.thumbnail_path,
    width: entry.width,
    height: entry.height,
    captured_at: entry.captured_at,
    created_at: entry.created_at,
    place,
  };

  return NextResponse.json({ entry: created }, { status: 201 });
}
