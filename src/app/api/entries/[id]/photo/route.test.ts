import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}));

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  // The real NO_HOUSEHOLD_MESSAGE, so a test asserting the copy cannot pass
  // against a stale duplicate of it.
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

import { GET } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

const HOUSEHOLD_ID = "household-uuid-1";

/**
 * Two clients, because the route uses two. The Entry is looked up with the
 * RLS-enforced one, so `entry: null` here is what another Household's Entry
 * actually looks like from this route: not a row it is refused, a row that
 * is not there.
 */
function stubSupabase(
  entry: { photo_path: string } | null,
  error: unknown = null,
) {
  const single = vi.fn().mockResolvedValue({ data: entry, error });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  type SignedUrl = {
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  };
  const createSignedUrl = vi.fn(async (path: string): Promise<SignedUrl> => ({
    data: { signedUrl: `https://signed.example/${path}?token=abc` },
    error: null,
  }));
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrl });

  requireHousehold.mockResolvedValue({ supabase: { from }, householdId: HOUSEHOLD_ID });
  createSupabaseServiceRoleClient.mockReturnValue({
    storage: { from: storageFrom },
  });

  return { from, select, eq, createSignedUrl, storageFrom };
}

async function get(id = "entry-uuid-1") {
  const response = await GET(
    new Request(`http://test/api/entries/${id}/photo`),
    { params: Promise.resolve({ id }) },
  );
  return { response, body: await response.json() };
}

describe("GET /api/entries/[id]/photo", () => {
  beforeEach(() => {
    createSupabaseServiceRoleClient.mockReset();
    requireHousehold.mockReset();
  });

  it("signs the full-resolution photo on demand", async () => {
    // Signed lazily, so a URL is never minted for a photo nobody opens.
    const supabase = stubSupabase({ photo_path: "place-uuid-1/photo.jpg" });

    const { response, body } = await get();

    expect(response.status).toBe(200);
    expect(body.url).toBe("https://signed.example/place-uuid-1/photo.jpg?token=abc");
    expect(supabase.storageFrom).toHaveBeenCalledWith("entry-photos");
    expect(supabase.createSignedUrl).toHaveBeenCalledWith(
      "place-uuid-1/photo.jpg",
      3600,
    );
  });

  it("404s on an Entry that doesn't exist", async () => {
    stubSupabase(null, { code: "PGRST116", message: "no rows" });

    const { response } = await get("nope");

    expect(response.status).toBe(404);
  });

  it("looks the Entry up as the caller, not as the service role", async () => {
    // The whole of story 19 rests on this. If the lookup ran as the service
    // role, RLS would not apply to it and an Entry id from another Household
    // would sign just fine.
    const supabase = stubSupabase({ photo_path: "place-uuid-1/photo.jpg" });

    await get();

    expect(requireHousehold).toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith("entries");
  });

  it("signs nothing for an Entry belonging to another Household", async () => {
    // RLS hides the row, so the route sees the same thing it sees for an id
    // that was never real -- and answers the same way, which is what keeps
    // the existence of someone else's dish private (stories 18 and 19).
    const supabase = stubSupabase(null, { code: "PGRST116", message: "no rows" });

    const { response, body } = await get("someone-elses-entry");

    expect(response.status).toBe(404);
    expect(body.error).toBe("No entry found.");
    expect(supabase.createSignedUrl).not.toHaveBeenCalled();
  });

  it("fails loudly when the credential belongs to no Household", async () => {
    const supabase = stubSupabase({ photo_path: "place-uuid-1/photo.jpg" });
    requireHousehold.mockResolvedValue(null);

    const { response, body } = await get();

    expect(response.status).toBe(500);
    expect(body.error).toBe(NO_HOUSEHOLD_MESSAGE);
    expect(supabase.createSignedUrl).not.toHaveBeenCalled();
  });

  it("fails loudly when signing fails", async () => {
    const supabase = stubSupabase({ photo_path: "place-uuid-1/photo.jpg" });
    supabase.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "storage unavailable" },
    });

    const { response } = await get();

    expect(response.status).toBe(500);
  });
});
