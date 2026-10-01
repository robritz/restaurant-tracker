import { describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { DELETE } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

const ADMIN = "admin-uuid";
const MEMBER = "member-uuid";

function stubSupabase(result: { error?: unknown; count?: number } = {}) {
  const eq = vi.fn().mockResolvedValue({
    error: result.error ?? null,
    count: result.count ?? 1,
  });
  const del = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ delete: del })), delete: del, eq };
}

function asAdmin(supabase: unknown) {
  requireHousehold.mockResolvedValue({
    supabase,
    householdId: "h1",
    userId: ADMIN,
    isAdmin: true,
  });
}

function asMember(supabase: unknown) {
  requireHousehold.mockResolvedValue({
    supabase,
    householdId: "h1",
    userId: MEMBER,
    isAdmin: false,
  });
}

function remove(memberId: string) {
  return DELETE(new Request(`http://localhost/api/members/${memberId}`, { method: "DELETE" }), {
    params: Promise.resolve({ memberId }),
  });
}

describe("DELETE /api/members/[memberId]", () => {
  describe("as the admin", () => {
    it("removes another phone, which is what ends its access", async () => {
      const supabase = stubSupabase();
      asAdmin(supabase);

      const response = await remove(MEMBER);

      expect(response.status).toBe(200);
      expect(supabase.from).toHaveBeenCalledWith("household_members");
      expect(supabase.eq).toHaveBeenCalledWith("user_id", MEMBER);
    });

    it("refuses to remove itself, so the Household keeps its admin", async () => {
      const supabase = stubSupabase();
      asAdmin(supabase);

      const response = await remove(ADMIN);

      expect(response.status).toBe(403);
      expect(supabase.delete).not.toHaveBeenCalled();
      const { error } = await response.json();
      expect(error).toMatch(/admin can't remove themselves/i);
      // Nothing in the app hands a Household over, so nothing should say so.
      expect(error).not.toMatch(/hand (the household|it) over/i);
    });
  });

  describe("as a member who is not the admin", () => {
    it("removes itself, which is how a phone leaves", async () => {
      const supabase = stubSupabase();
      asMember(supabase);

      const response = await remove(MEMBER);

      expect(response.status).toBe(200);
      expect(supabase.eq).toHaveBeenCalledWith("user_id", MEMBER);
    });

    it("refuses to remove anybody else", async () => {
      const supabase = stubSupabase();
      asMember(supabase);

      const response = await remove(ADMIN);

      expect(response.status).toBe(403);
      expect(supabase.delete).not.toHaveBeenCalled();
    });
  });

  it("says so when the policy removed nothing", async () => {
    // The route's own checks and the policies are separate; if they ever
    // disagree the policy wins, and this is what reports that.
    const supabase = stubSupabase({ count: 0 });
    asAdmin(supabase);

    expect((await remove(MEMBER)).status).toBe(403);
  });

  it("refuses a caller who belongs to no Household", async () => {
    requireHousehold.mockResolvedValue(null);

    const response = await remove(MEMBER);

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(NO_HOUSEHOLD_MESSAGE);
  });
});
