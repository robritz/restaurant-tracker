import { NextResponse } from "next/server";
import sharp from "sharp";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";
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
 */
function photoPaths(
  placeId: string,
  photo: File,
): { original: string; thumbnail: string } {
  const extension = photo.name.includes(".")
    ? photo.name.split(".").pop()!.toLowerCase()
    : "jpg";
  const base = `${placeId}/${crypto.randomUUID()}`;
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

  // Service role: there's no authenticated session yet to scope an
  // RLS-enforced write to.
  const supabase = createSupabaseServiceRoleClient();

  // Places are shared and deduped on mapbox_id, so a repeat visit reuses the
  // existing row (see docs/adr/0001-shared-deduped-place.md).
  const { data: place, error: placeError } = await supabase
    .from("places")
    .upsert(input.place, { onConflict: "mapbox_id" })
    .select()
    .single();

  if (placeError || !place) {
    return NextResponse.json(
      { error: "Unable to save the place for this entry." },
      { status: 500 },
    );
  }

  const paths = photoPaths(place.id, input.photo);
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(paths.original, input.photo, { contentType: input.photo.type });

  if (uploadError) {
    return NextResponse.json(
      { error: "Unable to upload the photo for this entry." },
      { status: 500 },
    );
  }

  const { error: thumbnailError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(paths.thumbnail, thumbnail.body, { contentType: "image/webp" });

  if (thumbnailError) {
    await supabase.storage.from(PHOTO_BUCKET).remove([paths.original]);
    return NextResponse.json(
      { error: "Unable to upload the photo for this entry." },
      { status: 500 },
    );
  }

  const { data: entry, error: entryError } = await supabase
    .from("entries")
    .insert({
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
    await supabase.storage
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
