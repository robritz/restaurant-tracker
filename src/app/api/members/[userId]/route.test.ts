import { describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { DELETE } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

function stubSupabase(result: { error?: unknown; count?: number } = {}) {
  const eq = vi.fn().mockResolvedValue({
    error: result.error ?? null,
    count: result.count ?? 1,
  });
  const del = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ delete: del })), delete: del, eq };
}

function remove(userId: string) {
  return DELETE(new Request(`http://localhost/api/members/${userId}`, { method: "DELETE" }), {
    params: Promise.resolve({ userId }),
  });
}

describe("DELETE /api/members/[userId]", () => {
  it("removes the membership, which is what ends that phone's access", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: "h1" });

    const response = await remove("user-uuid-2");

    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("household_members");
    expect(supabase.eq).toHaveBeenCalledWith("user_id", "user-uuid-2");
  });

  it("says so when the policy removed nothing -- removing yourself, or someone else's member", async () => {
    const supabase = stubSupabase({ count: 0 });
    requireHousehold.mockResolvedValue({ supabase, householdId: "h1" });

    const response = await remove("user-uuid-9");

    expect(response.status).toBe(403);
  });

  it("refuses a caller who belongs to no Household", async () => {
    requireHousehold.mockResolvedValue(null);

    const response = await remove("user-uuid-2");

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(NO_HOUSEHOLD_MESSAGE);
  });
});
