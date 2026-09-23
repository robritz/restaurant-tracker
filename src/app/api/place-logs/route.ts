import { NextResponse } from "next/server";
import { requireHousehold, NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

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
  // The RLS-enforced client, so every Entry this query touches is already
  // narrowed to the caller's Household. The route names no household_id
  // anywhere below: it cannot forget a filter it does not write.
  //
  // A missing Household is surfaced rather than answered with an empty list.
  // An empty map is what "you have logged nothing yet" looks like, and a
  // provisioning fault that borrows that appearance reads as lost data.
  const household = await requireHousehold();
  if (!household) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 500 });
  }
  const { supabase } = household;

  // !inner makes the join an inner one, so a Place with no *visible* Entries
  // never comes back at all. That covers two cases at once. A Place with no
  // Entries is the residue of a failed save -- a failed Entry leaves its
  // shared Place behind -- and is not somewhere anyone has eaten. A Place
  // where only another Household has eaten is not somewhere *we* have eaten,
  // and Places are shared, so without the join it would show up as a Pin for
  // a meal that was never ours.
  const { data, error } = await supabase
    .from("places")
    .select(
      "id, name, address, latitude, longitude, entries!inner (captured_at)",
    );

  if (error || !data) {
    return NextResponse.json(
      { error: "Unable to load the places you've eaten." },
      { status: 500 },
    );
  }

  const placeLogs = (data as PlaceRow[])
    .map(toSummary)
    .sort((a, b) => b.last_captured_at.localeCompare(a.last_captured_at));

  return NextResponse.json({ placeLogs });
}
