import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => createSupabaseServerClient(),
}));

import { requireHousehold } from "./household";

/**
 * `data` is the membership row the database hands back, or null. The helper
 * reads it through one RPC, so there is no query builder to stub.
 */
function stubClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ? [result.data] : result.data,
    error: result.error,
  });
  const from = vi.fn();
  createSupabaseServerClient.mockReturnValue({ rpc, from });
  return { rpc, from };
}

describe("requireHousehold", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
  });

  it("returns the caller's Household and a client to reach it with", async () => {
    // Both together, because getting either alone is a mistake: a client
    // without the Household cannot record an Entry, and the id without the
    // RLS-enforced client invites filtering by hand.
    stubClient({ data: { user_id: "u1", household_id: "household-uuid-1", role: "admin" }, error: null });

    const household = await requireHousehold();

    expect(household?.householdId).toBe("household-uuid-1");
    expect(household?.supabase).toBeDefined();
  });

  it("uses the RLS-enforced client, not the service role", async () => {
    stubClient({ data: { household_id: "household-uuid-1" }, error: null });

    await requireHousehold();

    expect(createSupabaseServerClient).toHaveBeenCalled();
  });

  it("asks the database for the caller's own membership, not for a row off the table", async () => {
    // A plain read of household_members shows every member of the Household,
    // not only the caller's row -- so `limit(1)` there would report an
    // arbitrary member's role as the caller's. The lookup goes through a
    // function keyed on auth.uid() instead.
    const { rpc, from } = stubClient({
      data: { user_id: "user-uuid-1", household_id: "household-uuid-1", role: "admin" },
      error: null,
    });

    await requireHousehold();

    expect(rpc).toHaveBeenCalledWith("current_household_membership");
    expect(from).not.toHaveBeenCalled();
  });

  it("returns who the caller is, so a route can tell them apart from another member", async () => {
    stubClient({
      data: { user_id: "user-uuid-2", household_id: "household-uuid-1", role: "member" },
      error: null,
    });

    expect((await requireHousehold())?.userId).toBe("user-uuid-2");
  });

  it("says when the caller is the Household's admin", async () => {
    stubClient({ data: { user_id: "u1", household_id: "household-uuid-1", role: "admin" }, error: null });

    expect((await requireHousehold())?.isAdmin).toBe(true);
  });

  it("says when the caller is a plain member", async () => {
    // The distinction the routes act on: inviting and removing somebody else
    // are the admin's, and a member who is neither must be told so rather
    // than discovering it as a policy refusal.
    stubClient({ data: { user_id: "u1", household_id: "household-uuid-1", role: "member" }, error: null });

    expect((await requireHousehold())?.isAdmin).toBe(false);
  });

  it("treats an unrecognised role as not admin", async () => {
    // Fail closed: a role this code has not been taught about must not be
    // read as permission.
    stubClient({ data: { user_id: "u1", household_id: "household-uuid-1", role: "owner" }, error: null });

    expect((await requireHousehold())?.isAdmin).toBe(false);
  });

  it("returns null when the caller belongs to no Household", async () => {
    // A valid credential with no membership. This returns the fact; the
    // routes decide it means a half-provisioned database.
    stubClient({ data: null, error: null });

    expect(await requireHousehold()).toBeNull();
  });

  it("returns null when the lookup fails", async () => {
    // Indistinguishable from "no Household" on purpose: both mean there is
    // no Household to record an Entry into, and the caller refuses either
    // way rather than guessing one.
    stubClient({ data: null, error: { message: "connection lost" } });

    expect(await requireHousehold()).toBeNull();
  });
});
