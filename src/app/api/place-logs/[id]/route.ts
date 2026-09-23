import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";
import { requireHousehold, NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/photos";
import { MAX_PLACE_LOG_ENTRIES } from "@/lib/place-logs";

/** One dish photographed at a Place, ready to draw in the gallery. */
export type PlaceLogEntry = {
  id: string;
  title: string;
  captured_at: string;
  /** Short-lived; the full-resolution photo is signed only when opened. */
  thumbnail_url: string;
  width: number;
  height: number;
};

/** A Place together with the dishes photographed there, newest first. */
export type PlaceLog = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  entries: PlaceLogEntry[];
};

type EntryRow = {
  id: string;
  title: string;
  captured_at: string;
  thumbnail_path: string;
  width: number;
  height: number;
};

type PlaceRow = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  entries: EntryRow[];
};

/**
 * The query already orders and caps these. Re-asserting it here is what
 * makes "newest first, at most MAX_PLACE_LOG_ENTRIES" a property of the response
 * rather than of how the query happens to be written today.
 */
function newestFirst(entries: EntryRow[]): EntryRow[] {
  return [...entries]
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
    .slice(0, MAX_PLACE_LOG_ENTRIES);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Two clients, doing two different jobs. This one is RLS-enforced, so the
  // Entries it returns are the caller's Household's and no one else's -- the
  // answer to "what have *we* eaten here?" rather than "what has anyone?".
  const household = await requireHousehold();
  if (!household) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 500 });
  }
  const { supabase } = household;

  const { data, error } = await supabase
    .from("places")
    .select(
      "id, name, address, latitude, longitude, entries (id, title, captured_at, thumbnail_path, width, height)",
    )
    .eq("id", id)
    // Ordered and capped in the query, so a Place with hundreds of dishes
    // never fetches hundreds of rows to throw most of them away.
    .order("captured_at", { referencedTable: "entries", ascending: false })
    .limit(MAX_PLACE_LOG_ENTRIES, { referencedTable: "entries" })
    .single();

  const place = data as PlaceRow | null;

  // No row, a Place nobody has eaten at, and a Place where only another
  // Household has eaten are all the same thing to a caller: there is no
  // PlaceLog at that id. Saying "forbidden" to the third would confirm that
  // somebody else's dishes are sitting there, which is the fact a Household
  // is entitled to keep.
  if (error || !place || place.entries.length === 0) {
    return NextResponse.json(
      { error: "No place log found." },
      { status: 404 },
    );
  }

  const entries = newestFirst(place.entries);

  // The service role, and only for storage: the bucket has no policies and
  // is protected by never handing out its key, so signing is the one thing
  // left that needs it (docs/adr/0005-service-role-for-storage-only.md).
  // Which paths get signed was decided above, under RLS.
  const { data: signed, error: signError } = await createSupabaseServiceRoleClient()
    .storage.from(PHOTO_BUCKET)
    .createSignedUrls(
      entries.map((entry) => entry.thumbnail_path),
      SIGNED_URL_TTL_SECONDS,
    );

  // Keyed by path rather than read positionally: Supabase documents no
  // ordering for createSignedUrls, and a mismatch would put one dish's
  // photo under another dish's Title -- wrong, and wrong in a way that
  // looks deliberate.
  const urlsByPath = new Map(
    (signed ?? []).flatMap((result) =>
      result.signedUrl && !result.error
        ? [[result.path, result.signedUrl] as const]
        : [],
    ),
  );

  // A path that can't be signed would leave a tile with no image and no
  // explanation, so treat it the same as the whole request failing.
  if (
    signError ||
    entries.some((entry) => !urlsByPath.has(entry.thumbnail_path))
  ) {
    return NextResponse.json(
      { error: "Unable to load the photos for this place." },
      { status: 500 },
    );
  }

  const placeLog: PlaceLog = {
    id: place.id,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      captured_at: entry.captured_at,
      thumbnail_url: urlsByPath.get(entry.thumbnail_path) as string,
      width: entry.width,
      height: entry.height,
    })),
  };

  return NextResponse.json({ placeLog });
}
