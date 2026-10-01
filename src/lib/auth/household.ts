import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseDataClient } from "@/lib/supabase/client";

/** What every route that touches a table needs: a client, and whose it is. */
export type HouseholdContext = {
  /**
   * RLS-enforced and request-scoped -- it runs as the signed-in caller, so
   * the policies narrow every read to this Household without the route
   * saying so.
   */
  supabase: SupabaseDataClient;
  householdId: string;
  /** The caller's own credential, for telling them apart from another member. */
  userId: string;
  /**
   * Whether the caller runs this Household: the account it was seeded with.
   * Inviting a phone and removing somebody else's are the admin's; everyone
   * else can only remove themselves.
   *
   * The policies enforce all of that independently -- this is here so a route
   * can say "only an admin can do that" instead of surfacing a refusal the
   * caller cannot interpret.
   */
  isAdmin: boolean;
};

/**
 * The same message wherever a signed-in caller turns out to belong to no
 * Household, so the three routes cannot drift into describing one situation
 * three ways.
 */
export const NO_HOUSEHOLD_MESSAGE =
  "Your sign-in is not attached to a household.";

/**
 * The caller's Household, and the client to reach their data with.
 *
 * One helper rather than two calls, because these two things are always
 * wanted together and getting either one alone is a mistake: a client
 * without the Household cannot record an Entry, and a Household id without
 * the RLS-enforced client invites filtering by hand. It is also the single
 * seam the route tests mock.
 *
 * Returns null when the caller belongs to no Household. That is not a
 * permission problem -- the middleware has already established there is a
 * valid session -- but a half-provisioned database, since the seed always
 * creates an identity and its Household together.
 *
 * The lookup goes through `current_household_membership()` rather than
 * reading `household_members` directly. An earlier version did read it
 * directly with no `user_id` filter, reasoning that RLS "shows a caller only
 * their own memberships" -- which was never so. The select policy is
 * household-wide, so a caller sees every member; with one member per
 * Household that was harmless, and with a second phone and a role column it
 * would have reported an arbitrary member's role as the caller's.
 *
 * One Household per credential still. The function's own `limit(1)` is that
 * assumption, and `accept_household_invite` refuses a credential already in
 * one, so nothing can produce a second.
 */
export async function requireHousehold(): Promise<HouseholdContext | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("current_household_membership");
  const membership = data?.[0];

  if (error || !membership) return null;
  // Compared against "admin" rather than against "member", so a role this
  // code has not been taught about reads as no permission at all.
  return {
    supabase,
    householdId: membership.household_id,
    userId: membership.user_id,
    isAdmin: membership.role === "admin",
  };
}
