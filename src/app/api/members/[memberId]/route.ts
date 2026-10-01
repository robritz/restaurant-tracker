import { NextResponse } from "next/server";
import { NO_HOUSEHOLD_MESSAGE, requireHousehold } from "@/lib/auth/household";

/**
 * Removes a phone's access to the Household.
 *
 * Who may remove whom: the admin removes anyone but themselves, and everyone
 * else removes only themselves. So an invited phone can leave on its own, and
 * cannot remove the account that invited it; and the Household always keeps
 * the admin, so it can never be emptied and stranded with Entries nobody can
 * reach.
 *
 * Deleting the membership is the whole of it: every policy in this schema
 * reads membership live, so the next query that credential makes comes back
 * empty. There is no cached grant to wait out.
 *
 * The sign-in itself survives, attached to nothing -- it can still
 * authenticate and will see the "not attached to a household" state. Deleting
 * the identity as well would need the service role for a reason that is not
 * storage, and the access this route exists to end has already ended.
 */
export async function DELETE(
  _request: Request,
  // A Member is identified by the credential it is a membership *of*, which
  // is `household_members.user_id`. The segment is named for the domain
  // concept rather than the column: CONTEXT.md keeps "User" off the
  // vocabulary deliberately.
  { params }: { params: Promise<{ memberId: string }> },
) {
  const context = await requireHousehold();
  if (!context) {
    return NextResponse.json({ error: NO_HOUSEHOLD_MESSAGE }, { status: 403 });
  }

  const { memberId } = await params;
  const self = memberId === context.userId;

  // The two policies on household_members enforce both of these too, and are
  // the real gate. Checking here is what turns a refusal into an answer that
  // says which rule was met and what to do instead.
  if (context.isAdmin && self) {
    return NextResponse.json(
      // No offer to hand the household over: there is no way to do that, and
      // a message that suggests one sends someone looking for a screen that
      // does not exist.
      { error: "An admin can't remove themselves. Sign out to leave this phone." },
      { status: 403 },
    );
  }

  if (!context.isAdmin && !self) {
    return NextResponse.json(
      { error: "Only the household's admin can remove another phone." },
      { status: 403 },
    );
  }

  // `count` is what distinguishes "removed" from "the policy matched
  // nothing": a delete that matches no row is not an error in Postgres, so
  // without it a refusal would report success and change nothing.
  const { error, count } = await context.supabase
    .from("household_members")
    .delete({ count: "exact" })
    .eq("user_id", memberId);

  if (error) {
    return NextResponse.json(
      { error: "Unable to remove that member right now." },
      { status: 500 },
    );
  }

  if (!count) {
    return NextResponse.json(
      { error: "That member isn't yours to remove." },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true });
}
