import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";

const PHOTO_BUCKET = "entry-photos";

// An hour is far longer than a panel session, and nothing here detects or
// refreshes an expired URL: a PlaceLog is re-fetched every time its pin is
// selected, which is what keeps its URLs fresh.
const SIGNED_URL_TTL_SECONDS = 3600;

// Not expected to be reached -- it exists so one request can never sign an
// unbounded number of URLs.
const MAX_ENTRIES = 50;

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

function newestFirst(entries: EntryRow[]): EntryRow[] {
  return [...entries]
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
    .slice(0, MAX_ENTRIES);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Service role: RLS is on with no policies, and the photos live in a
  // private bucket. Signed URLs are the only form in which they reach the
  // browser.
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("places")
    .select(
      "id, name, address, latitude, longitude, entries (id, title, captured_at, thumbnail_path, width, height)",
    )
    .eq("id", id)
    .single();

  const place = data as PlaceRow | null;

  // No row, or a Place nobody has eaten at, are the same thing to a caller:
  // there is no PlaceLog at that id.
  if (error || !place || place.entries.length === 0) {
    return NextResponse.json(
      { error: "No place log found." },
      { status: 404 },
    );
  }

  const entries = newestFirst(place.entries);

  const { data: signed, error: signError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(
      entries.map((entry) => entry.thumbnail_path),
      SIGNED_URL_TTL_SECONDS,
    );

  // A path that can't be signed would leave a tile with no image and no
  // explanation, so treat it the same as the whole request failing.
  if (signError || !signed || signed.some((url) => !url.signedUrl)) {
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
    entries: entries.map((entry, index) => ({
      id: entry.id,
      title: entry.title,
      captured_at: entry.captured_at,
      thumbnail_url: signed[index].signedUrl!,
      width: entry.width,
      height: entry.height,
    })),
  };

  return NextResponse.json({ placeLog });
}
