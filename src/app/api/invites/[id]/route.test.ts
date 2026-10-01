import { describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { DELETE } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

function stubSupabase(result: { error?: unknown } = {}) {
  const eq = vi.fn().mockResolvedValue({ error: result.error ?? null });
  const del = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ delete: del })), delete: del, eq };
}

function revoke(id: string) {
  return DELETE(new Request(`http://localhost/api/invites/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

describe("DELETE /api/invites/[id]", () => {
  it("deletes the invite, which is what revoking one is", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: "h1", isAdmin: true });

    const response = await revoke("invite-uuid-1");

    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("household_invites");
    expect(supabase.eq).toHaveBeenCalledWith("id", "invite-uuid-1");
  });

  it("names no Household in the delete -- the policy is what scopes it", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: "h1", isAdmin: true });

    await revoke("invite-uuid-1");

    expect(supabase.eq).toHaveBeenCalledTimes(1);
  });

  it("refuses a member who is not the admin", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: "h1", isAdmin: false });

    const response = await revoke("invite-uuid-1");

    expect(response.status).toBe(403);
    expect(supabase.delete).not.toHaveBeenCalled();
  });

  it("refuses a caller who belongs to no Household", async () => {
    requireHousehold.mockResolvedValue(null);

    const response = await revoke("invite-uuid-1");

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(NO_HOUSEHOLD_MESSAGE);
  });

  it("reports a refused delete", async () => {
    const supabase = stubSupabase({ error: { message: "denied" } });
    requireHousehold.mockResolvedValue({ supabase, householdId: "h1", isAdmin: true });

    expect((await revoke("invite-uuid-1")).status).toBe(500);
  });
});
