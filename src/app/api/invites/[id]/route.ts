import { NextResponse } from "next/server";
import { NO_HOUSEHOLD_MESSAGE, requireHousehold } from "@/lib/auth/household";

/**
 * Revokes an invite by deleting it. There is no "revoked" state to keep: a
 * row that is gone cannot be redeemed, and nothing is simpler to be sure of.
 *
 * No household filter here on purpose. The delete policy only matches rows in
 * the caller's own Household, so adding one would duplicate a rule the
 * database already enforces -- and the copy is the half that can drift.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await requireHousehold();
  if (!context) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 403 });
  }

  const { id } = await params;
  const { error } = await context.supabase
    .from("household_invites")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: "Unable to revoke that invite right now." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
