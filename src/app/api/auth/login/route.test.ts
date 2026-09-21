import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithPassword } }),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const CREDENTIALS = { email: "family@example.com", password: "correct horse" };

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    signInWithPassword.mockResolvedValue({ error: null });
  });

  it("signs in with the submitted credentials", async () => {
    const response = await post(CREDENTIALS);

    expect(response.status).toBe(200);
    expect(signInWithPassword).toHaveBeenCalledWith(CREDENTIALS);
  });

  it("trims the email, so a padded autofill still matches", async () => {
    await post({ email: "  family@example.com  ", password: "correct horse" });

    expect(signInWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: "family@example.com" }),
    );
  });

  it("rejects a request missing a field", async () => {
    const response = await post({ email: "family@example.com" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "'password' is required.",
    });
  });

  it("rejects a body that isn't JSON", async () => {
    const response = await post("not json");

    expect(response.status).toBe(400);
  });

  it("reports a wrong password without saying which half was wrong", async () => {
    signInWithPassword.mockResolvedValue({
      error: { status: 400, message: "Invalid login credentials" },
    });

    const response = await post(CREDENTIALS);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("That email and password don't match.");
    // Naming the half that was wrong would confirm whether an address has an
    // account here.
    expect(body.error).not.toMatch(/password is|no account|unknown email/i);
  });

  /**
   * The point of these two: a rate limit and an outage are not wrong
   * passwords, and telling someone to re-check a password they typed
   * correctly sends them in circles.
   */
  it("says so when sign-in is rate limited", async () => {
    signInWithPassword.mockResolvedValue({
      error: { status: 429, message: "Too many requests" },
    });

    const response = await post(CREDENTIALS);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/too many/i),
    });
  });

  it("does not blame the password when the auth service fails", async () => {
    signInWithPassword.mockResolvedValue({
      error: { status: 500, message: "Internal error" },
    });

    const response = await post(CREDENTIALS);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).not.toMatch(/don't match/i);
  });
});
