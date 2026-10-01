import { NextResponse } from "next/server";
import { NO_HOUSEHOLD_MESSAGE, requireHousehold } from "@/lib/auth/household";

/**
 * Removes a phone's access to the Household.
 *
 * Deleting the membership is the whole of it: every policy in this schema
 * reads membership live, so the next query that credential makes comes back
 * empty. There is no cached grant to wait out.
 *
 * The sign-in itself survives, attached to nothing -- it can still
 * authenticate and will see the "not attached to a household" state. Deleting
 * the identity as well would need the service role for a reason that is not
 * storage, and the access this route exists to end has already ended.
 *
 * `count` is what distinguishes "removed" from "the policy matched nothing":
 * a delete that matches no row is not an error in Postgres, so without it,
 * trying to remove yourself would report success and change nothing.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const context = await requireHousehold();
  if (!context) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 403 });
  }

  const { userId } = await params;
  const { error, count } = await context.supabase
    .from("household_members")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json(
      { error: "Unable to remove that member right now." },
      { status: 500 },
    );
  }

  if (!count) {
    return NextResponse.json(
      { error: "That member isn't yours to remove. Sign out to leave yourself." },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true });
}
