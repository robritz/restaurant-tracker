import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

class InvalidCredentialsError extends Error {}

function requireText(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidCredentialsError(`'${field}' is required.`);
  }
  return value.trim();
}

/**
 * Not every failed sign-in is a wrong password. Flattening a rate limit or an
 * outage into "check your password" sends someone to re-type a password they
 * typed correctly, and keeps them there.
 */
function signInFailure(status: number | undefined) {
  if (status === 429) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  if (status === 400 || status === 401 || status === 403) {
    // Deliberately the same message whether the email is unknown or the
    // password is wrong: saying which would tell an attacker that an address
    // has an account here.
    return NextResponse.json(
      { error: "That email and password don't match." },
      { status: 401 },
    );
  }

  return NextResponse.json(
    { error: "Unable to sign in right now. Try again shortly." },
    { status: 503 },
  );
}

/**
 * Exchanges an email and password for a session, set as cookies on the
 * response.
 *
 * Signing in happens here rather than in the browser so that SUPABASE_URL and
 * SUPABASE_ANON_KEY stay server-only, as they are everywhere else in this
 * project -- the browser never needs a Supabase client, so it never gets one.
 */
export async function POST(request: Request) {
  let email: string;
  let password: string;
  try {
    const body = await request.json();
    email = requireText(body, "email");
    password = requireText(body, "password");
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Expected an email and a password." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return signInFailure(error.status);

  return NextResponse.json({ ok: true });
}
