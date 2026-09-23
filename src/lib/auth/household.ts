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
 * Note the absence of a `user_id` filter on the lookup. `household_members`
 * is itself behind RLS and shows a caller only their own memberships, so the
 * filter would be a second copy of a rule the database already enforces --
 * and the copy, not the original, is the one that can drift.
 *
 * One Household per credential today. `limit(1)` is what that assumption
 * looks like in code: when a credential can join two, this is the call that
 * has to start asking which one.
 */
export async function requireHousehold(): Promise<HouseholdContext | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("household_members")
    .select("household_id")
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return { supabase, householdId: data.household_id };
}
