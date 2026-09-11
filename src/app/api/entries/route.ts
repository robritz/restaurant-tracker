import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";
import type { Place } from "@/app/api/places/route";

const PHOTO_BUCKET = "entry-photos";

/** A saved Entry: one photo, one dish title, one Place, one captured-at. */
export type Entry = {
  id: string;
  title: string;
  photo_path: string;
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

function photoPath(placeId: string, photo: File): string {
  const extension = photo.name.includes(".")
    ? photo.name.split(".").pop()!.toLowerCase()
    : "jpg";
  return `${placeId}/${crypto.randomUUID()}.${extension}`;
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

  const path = photoPath(place.id, input.photo);
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, input.photo, { contentType: input.photo.type });

  if (uploadError) {
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
      photo_path: path,
      captured_at: input.capturedAt,
    })
    .select()
    .single();

  if (entryError || !entry) {
    // Don't leave the photo behind for an Entry that was never created. The
    // place row stays -- it's shared, so other Entries may reference it.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return NextResponse.json(
      { error: "Unable to save this entry." },
      { status: 500 },
    );
  }

  const created: Entry = {
    id: entry.id,
    title: entry.title,
    photo_path: entry.photo_path,
    captured_at: entry.captured_at,
    created_at: entry.created_at,
    place,
  };

  return NextResponse.json({ entry: created }, { status: 201 });
}
