import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";
import { requireHousehold, NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/photos";

/**
 * A short-lived URL for one Entry's full-resolution photo, signed only when
 * the dish is opened full-screen. The gallery never carries these: minting
 * one per dish on every panel load would sign URLs for photos nobody looks
 * at, and the bucket is private precisely so a URL is the only way in.
 *
 * The lookup below is what makes an Entry id useless to anyone outside the
 * Household that recorded it. A signed URL is bearer access to the photo, so
 * the question "may this caller have one?" has to be answered before one is
 * minted -- and it is answered by the database, by the row simply not being
 * there to find.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // RLS-enforced: another Household's Entry is not missing-and-forbidden, it
  // is simply not there, and the 404 below says so without distinguishing it
  // from an id that never existed.
  const household = await requireHousehold();
  if (!household) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 500 });
  }
  const { supabase } = household;

  const { data: entry, error } = await supabase
    .from("entries")
    .select("photo_path")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "No entry found." }, { status: 404 });
  }

  // Only now, on a path that belongs to the caller, does the service role
  // come out -- and only to sign
  // (docs/adr/0005-service-role-for-storage-only.md).
  const { data: signed, error: signError } = await createSupabaseServiceRoleClient()
    .storage.from(PHOTO_BUCKET)
    .createSignedUrl(entry.photo_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return NextResponse.json(
      { error: "Unable to load this photo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
