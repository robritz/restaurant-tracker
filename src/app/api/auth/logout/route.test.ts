import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    signOut.mockReset();
    signOut.mockResolvedValue({ error: null });
  });

  it("ends the session", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(signOut).toHaveBeenCalled();
  });

  /**
   * The browser navigates to the login screen either way, and a caller with
   * no session is already in the state they asked for -- reporting a failure
   * would only strand them on a page they are being sent away from.
   */
  it("reports success even when clearing the session failed", async () => {
    signOut.mockResolvedValue({ error: { message: "network" } });

    const response = await POST();

    expect(response.status).toBe(200);
  });
});
