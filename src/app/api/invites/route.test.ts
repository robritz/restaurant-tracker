import { describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { POST } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";
import { hashInviteToken, INVITE_LIFETIME_MS } from "@/lib/invites/token";

const HOUSEHOLD_ID = "household-uuid-1";

function stubSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const single = vi.fn().mockResolvedValue({
    data: result.data ?? { id: "invite-uuid-1" },
    error: result.error ?? null,
  });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((_row: Record<string, string>) => ({ select }));
  return { from: vi.fn(() => ({ insert })), insert, select, single };
}

function post() {
  return POST();
}

describe("POST /api/invites", () => {
  it("hands back a link the issuer can copy, and the token only here", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: HOUSEHOLD_ID });

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.path).toMatch(/^\/join\/[A-Za-z0-9_-]{43}$/);
    expect(body.id).toBe("invite-uuid-1");
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("stores the hash, never the token", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: HOUSEHOLD_ID });

    const body = await (await post()).json();
    const token = body.path.replace("/join/", "");
    const row = supabase.insert.mock.calls[0]![0];

    expect(row.token_hash).toBe(hashInviteToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("stamps the issuer's own Household, so an invite reaches only it", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: HOUSEHOLD_ID });

    await post();

    expect(supabase.insert.mock.calls[0]![0].household_id).toBe(HOUSEHOLD_ID);
  });

  it("expires the invite", async () => {
    const supabase = stubSupabase();
    requireHousehold.mockResolvedValue({ supabase, householdId: HOUSEHOLD_ID });

    const before = Date.now();
    await post();
    const expiresAt = Date.parse(supabase.insert.mock.calls[0]![0].expires_at);

    expect(expiresAt).toBeGreaterThanOrEqual(before + INVITE_LIFETIME_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + INVITE_LIFETIME_MS);
  });

  it("issues nothing for a caller who belongs to no Household", async () => {
    requireHousehold.mockResolvedValue(null);

    const response = await post();

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(NO_HOUSEHOLD_MESSAGE);
  });

  it("reports a refused insert rather than handing back a dead link", async () => {
    const supabase = stubSupabase({ data: null, error: { message: "denied" } });
    requireHousehold.mockResolvedValue({ supabase, householdId: HOUSEHOLD_ID });

    const response = await post();

    expect(response.status).toBe(500);
    expect((await response.json()).path).toBeUndefined();
  });
});
