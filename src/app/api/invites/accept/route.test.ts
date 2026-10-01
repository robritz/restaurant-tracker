import { beforeEach, describe, expect, it, vi } from "vitest";

const createUser = vi.fn();
const deleteUser = vi.fn();
const createSupabaseServiceRoleClient = vi.fn(() => ({
  auth: { admin: { createUser, deleteUser } },
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}));

const rpc = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const createSupabaseServerClient = vi.fn(async () => ({
  rpc,
  auth: { signInWithPassword, signOut },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClient(),
}));

import { POST } from "./route";
import { hashInviteToken } from "@/lib/invites/token";

const TOKEN = "a".repeat(43);
const HOUSEHOLD_ID = "household-uuid-1";
const NEW_USER = { id: "user-uuid-2" };

function accept(body: unknown) {
  return POST(
    new Request("http://localhost/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const GOOD = { token: TOKEN, email: "partner@example.com", password: "hunter2hunter2" };

beforeEach(() => {
  vi.clearAllMocks();
  // Live invite, user created, signed in, invite claimed.
  rpc.mockImplementation(async (fn: string) =>
    fn === "household_for_invite"
      ? { data: HOUSEHOLD_ID, error: null }
      : { data: HOUSEHOLD_ID, error: null },
  );
  createUser.mockResolvedValue({ data: { user: NEW_USER }, error: null });
  signInWithPassword.mockResolvedValue({ error: null });
  deleteUser.mockResolvedValue({ error: null });
});

describe("POST /api/invites/accept", () => {
  it("creates the credential and joins it to the inviting Household", async () => {
    const response = await accept(GOOD);

    expect(response.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: GOOD.email, password: GOOD.password }),
    );
    expect(rpc).toHaveBeenCalledWith("accept_household_invite", {
      p_token_hash: hashInviteToken(TOKEN),
    });
  });

  it("looks the invite up by hash, so the token itself is never sent to the database", async () => {
    await accept(GOOD);

    const args = rpc.mock.calls.map(([, params]) => JSON.stringify(params ?? {}));
    expect(args.join()).not.toContain(TOKEN);
    expect(rpc).toHaveBeenCalledWith("household_for_invite", {
      p_token_hash: hashInviteToken(TOKEN),
    });
  });

  it("claims the invite as the new credential, after signing it in", async () => {
    await accept(GOOD);

    // The claim runs as the joiner, which is what stops the token from being
    // usable to push anyone else into a Household.
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: GOOD.email,
      password: GOOD.password,
    });
    const order = [
      signInWithPassword.mock.invocationCallOrder[0],
      rpc.mock.invocationCallOrder[rpc.mock.calls.length - 1],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it("refuses a token that is expired, spent, or never existed -- all alike", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const response = await accept(GOOD);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(createUser).not.toHaveBeenCalled();
    // Says nothing about which Household it was, or whether it ever existed.
    expect(JSON.stringify(body)).not.toContain(HOUSEHOLD_ID);
  });

  it("does not burn the invite when the email is already taken", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "already registered", status: 422 },
    });

    const response = await accept(GOOD);

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalledWith(
      "accept_household_invite",
      expect.anything(),
    );
  });

  it("removes the credential it just made when the claim is lost to a race", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "household_for_invite"
        ? { data: HOUSEHOLD_ID, error: null }
        : { data: null, error: null },
    );

    const response = await accept(GOOD);

    expect(response.status).toBe(410);
    expect(deleteUser).toHaveBeenCalledWith(NEW_USER.id);
  });

  it("rejects a password too short to be worth having", async () => {
    const response = await accept({ ...GOOD, password: "short" });

    expect(response.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("rejects a missing token, email, or password", async () => {
    for (const field of ["token", "email", "password"]) {
      const body: Record<string, unknown> = { ...GOOD };
      delete body[field];
      expect((await accept(body)).status).toBe(400);
    }
    expect(createUser).not.toHaveBeenCalled();
  });
});
