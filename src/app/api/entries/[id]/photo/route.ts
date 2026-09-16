import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";

const PHOTO_BUCKET = "entry-photos";

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * A short-lived URL for one Entry's full-resolution photo, signed only when
 * the dish is opened full-screen. The gallery never carries these: minting
 * one per dish on every panel load would sign URLs for photos nobody looks
 * at, and the bucket is private precisely so a URL is the only way in.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createSupabaseServiceRoleClient();

  const { data: entry, error } = await supabase
    .from("entries")
    .select("photo_path")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "No entry found." }, { status: 404 });
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(entry.photo_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return NextResponse.json(
      { error: "Unable to load this photo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
