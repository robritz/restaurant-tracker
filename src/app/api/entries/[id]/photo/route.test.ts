import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}));

import { GET } from "./route";

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

  createSupabaseServiceRoleClient.mockReturnValue({
    from,
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
