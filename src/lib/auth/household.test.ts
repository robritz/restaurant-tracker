import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => createSupabaseServerClient(),
}));

import { requireHousehold } from "./household";

function stubClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ select });
  createSupabaseServerClient.mockReturnValue({ from });
  return { from, select, limit };
}

describe("requireHousehold", () => {
  beforeEach(() => {
    createSupabaseServerClient.mockReset();
  });

  it("returns the caller's Household and a client to reach it with", async () => {
    // Both together, because getting either alone is a mistake: a client
    // without the Household cannot record an Entry, and the id without the
    // RLS-enforced client invites filtering by hand.
    stubClient({ data: { household_id: "household-uuid-1" }, error: null });

    const household = await requireHousehold();

    expect(household?.householdId).toBe("household-uuid-1");
    expect(household?.supabase).toBeDefined();
  });

  it("uses the RLS-enforced client, not the service role", async () => {
    stubClient({ data: { household_id: "household-uuid-1" }, error: null });

    await requireHousehold();

    expect(createSupabaseServerClient).toHaveBeenCalled();
  });

  it("asks for memberships without filtering by user", async () => {
    // household_members is itself behind RLS and shows a caller only their
    // own rows, so a user_id filter here would be a second copy of a rule
    // the database already enforces -- and the copy is the one that drifts.
    const { from, select } = stubClient({
      data: { household_id: "household-uuid-1" },
      error: null,
    });

    await requireHousehold();

    expect(from).toHaveBeenCalledWith("household_members");
    expect(select).toHaveBeenCalledWith("household_id");
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
