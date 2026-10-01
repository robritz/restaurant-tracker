import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashInviteToken } from "@/lib/invites/token";
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT } from "@/lib/auth/password";

/**
 * The same answer for expired, already used, revoked and never-existed. Which
 * one it was is not the joiner's business and would make a token oracle.
 */
const DEAD_INVITE = "That invite is no longer valid. Ask for a new one.";

/**
 * Supabase reports a duplicate address as `email_exists`; older versions only
 * said so in the message, so both are checked.
 */
function takenEmail(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "email_exists" ||
    /already (been )?registered|already exists/i.test(error.message ?? "")
  );
}

function field(body: unknown, name: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Redeems an invite: creates the credential, signs it in, and joins it to the
 * Household that issued the token.
 *
 * Reachable without a session -- the whole point is that the joiner has none
 * yet -- so the token is the only thing standing in for authorisation, which
 * is why it is 32 random bytes and why this route tells a bad one nothing.
 *
 * The service role appears here for `auth.admin`, and for nothing else: every
 * table touch goes through the RLS-enforced client or a definer function that
 * scopes itself (docs/adr/0006-invites-create-credentials.md).
 *
 * Order matters. The credential is created before the invite is claimed, so a
 * taken email does not spend the invite; the claim then happens as the new
 * credential, so a token cannot be used to push somebody else into a
 * Household. If the claim is lost to a simultaneous redemption, the
 * credential just created is removed again rather than left stranded.
 */
export async function POST(request: Request) {
  let token: string | null;
  let email: string | null;
  let password: string | null;
  try {
    const body = await request.json();
    token = field(body, "token");
    email = field(body, "email");
    password = field(body, "password");
  } catch {
    return NextResponse.json(
      { error: "Expected an invite, an email and a password." },
      { status: 400 },
    );
  }

  if (!token || !email || !password) {
    return NextResponse.json(
      { error: "An invite, an email and a password are all required." },
      { status: 400 },
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: PASSWORD_TOO_SHORT }, { status: 400 });
  }

  const tokenHash = hashInviteToken(token);
  const supabase = await createSupabaseServerClient();

  // Checked before anything is created, so a bad link costs nothing and
  // leaves nothing behind.
  const { data: household } = await supabase.rpc("household_for_invite", {
    p_token_hash: tokenHash,
  });
  if (!household) {
    return NextResponse.json({ error: DEAD_INVITE }, { status: 410 });
  }

  const admin = createSupabaseServiceRoleClient();
  // email_confirm: there is no inbox round-trip in this app, and the invite
  // already establishes that whoever holds it was vouched for by a member.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    // A taken email is the one failure the joiner can act on, and the only
    // one worth naming. Reporting an outage or a rejected password as "that
    // email is taken" would send someone to invent a second address for a
    // problem a different address will not fix.
    return takenEmail(createError)
      ? NextResponse.json(
          { error: "That email already has a sign-in. Use a different one." },
          { status: 409 },
        )
      : NextResponse.json(
          { error: "Unable to set up that sign-in. Try again shortly." },
          { status: 503 },
        );
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: "Unable to sign you in. Try again shortly." },
      { status: 503 },
    );
  }

  // Runs as the credential just signed in: accept_household_invite() reads
  // auth.uid() and joins *that* identity, so there is no user id to pass and
  // none to get wrong.
  const { data: joined } = await supabase.rpc("accept_household_invite", {
    p_token_hash: tokenHash,
  });

  if (!joined) {
    // Someone else redeemed it between the check above and the claim. Undo
    // the credential rather than leave a sign-in attached to no Household.
    await supabase.auth.signOut();
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: DEAD_INVITE }, { status: 410 });
  }

  // The session cookies are already set by the sign-in above, so the joiner
  // lands in the app rather than back at the login screen.
  return NextResponse.json({ ok: true });
}
