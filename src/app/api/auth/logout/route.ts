import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Ends the session and clears its cookies. Always reports success: a caller
 * with no session is already in the state they asked for, and the browser
 * navigates to the login screen either way.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
