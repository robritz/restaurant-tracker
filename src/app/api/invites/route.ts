import { NextResponse } from "next/server";
import { NO_HOUSEHOLD_MESSAGE, requireHousehold } from "@/lib/auth/household";
import {
  hashInviteToken,
  invitePath,
  inviteExpiry,
  newInviteToken,
} from "@/lib/invites/token";

/**
 * Issues a single-use invite into the caller's own Household.
 *
 * The token is returned here and nowhere else -- only its hash is stored, so
 * there is no second chance to read it. Losing the link means issuing
 * another, which is the right trade for a credential-bearing URL.
 *
 * A path rather than an absolute URL: the browser appends its own origin, so
 * a spoofed Host header cannot steer an invite at another site.
 */
export async function POST() {
  const context = await requireHousehold();
  if (!context) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 403 });
  }

  const token = newInviteToken();
  const expiresAt = inviteExpiry();

  // household_id is stamped from the caller's own context, and the insert
  // policy independently refuses any other -- the route cannot widen its
  // reach by getting this wrong.
  const { data, error } = await context.supabase
    .from("household_invites")
    .insert({
      household_id: context.householdId,
      token_hash: hashInviteToken(token),
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Unable to create an invite right now." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { id: data.id, path: invitePath(token), expiresAt: expiresAt.toISOString() },
    { status: 201 },
  );
}
