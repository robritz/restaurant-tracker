import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";

/**
 * One pin's worth of a PlaceLog: the Place, plus enough about its Entries to
 * tell a regular haunt from a one-off. Deliberately carries no photo URLs --
 * signing one per Place on every map load would cost far more than it buys,
 * since most pins are never opened.
 */
export type PlaceLogSummary = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  entry_count: number;
  last_captured_at: string;
};

type PlaceRow = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  entries: { captured_at: string }[];
};

function toSummary(place: PlaceRow): PlaceLogSummary {
  const capturedAt = place.entries.map((entry) => entry.captured_at);
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    entry_count: capturedAt.length,
    last_captured_at: capturedAt.reduce((latest, current) =>
      current > latest ? current : latest,
    ),
  };
}

export async function GET() {
  // Service role: RLS is on with no policies, so the anon key can read
  // nothing. Scoping to a user arrives with auth.
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("places")
    .select("id, name, address, latitude, longitude, entries (captured_at)")
    .order("name");

  if (error || !data) {
    return NextResponse.json(
      { error: "Unable to load the places you've eaten." },
      { status: 500 },
    );
  }

  const placeLogs = (data as PlaceRow[])
    // A Place with no Entries is not somewhere you've eaten -- it's the
    // residue of a failed save, since a failed Entry leaves its shared Place
    // behind. Never pin one.
    .filter((place) => place.entries.length > 0)
    .map(toSummary)
    .sort((a, b) => b.last_captured_at.localeCompare(a.last_captured_at));

  return NextResponse.json({ placeLogs });
}
