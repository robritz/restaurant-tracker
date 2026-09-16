import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}));

import { GET } from "./route";

const DINER = {
  id: "place-uuid-1",
  name: "Test Diner",
  address: "123 Main St",
  latitude: 40.0,
  longitude: -73.0,
};

type EntryRow = {
  id: string;
  title: string;
  captured_at: string;
  thumbnail_path: string;
  width: number;
  height: number;
};

function entry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: "entry-uuid-1",
    title: "Margherita Pizza",
    captured_at: "2026-01-01T12:00:00.000Z",
    thumbnail_path: "place-uuid-1/photo-thumb.webp",
    width: 800,
    height: 600,
    ...overrides,
  };
}

/**
 * Shapes the single-row select the route uses: one Place carrying its
 * Entries, plus the storage client the thumbnail URLs are signed with.
 */
function stubSupabase(
  place: (typeof DINER & { entries: EntryRow[] }) | null,
  error: unknown = null,
) {
  const single = vi.fn().mockResolvedValue({ data: place, error });
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ single, limit });
  const eq = vi.fn().mockReturnValue({ single, order, limit });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  type SignedUrls = {
    data: { path: string; signedUrl: string | null; error: string | null }[] | null;
    error: { message: string } | null;
  };
  const createSignedUrls = vi.fn(async (paths: string[]): Promise<SignedUrls> => ({
    data: paths.map((path) => ({
      path,
      signedUrl: `https://signed.example/${path}?token=abc`,
      error: null,
    })),
    error: null,
  }));
  const storageFrom = vi.fn().mockReturnValue({ createSignedUrls });

  createSupabaseServiceRoleClient.mockReturnValue({
    from,
    storage: { from: storageFrom },
  });

  return { from, select, eq, createSignedUrls, storageFrom };
}

async function get(id = "place-uuid-1") {
  const response = await GET(new Request(`http://test/api/place-logs/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { response, body: await response.json() };
}

describe("GET /api/place-logs/[id]", () => {
  beforeEach(() => {
    createSupabaseServiceRoleClient.mockReset();
  });

  it("returns the Place with its dishes", async () => {
    stubSupabase({ ...DINER, entries: [entry()] });

    const { response, body } = await get();

    expect(response.status).toBe(200);
    expect(body.placeLog).toMatchObject({
      id: "place-uuid-1",
      name: "Test Diner",
      address: "123 Main St",
      latitude: 40.0,
      longitude: -73.0,
    });
    expect(body.placeLog.entries).toHaveLength(1);
  });

  it("gives each dish a signed thumbnail URL and its dimensions", async () => {
    stubSupabase({ ...DINER, entries: [entry()] });

    const { body } = await get();

    expect(body.placeLog.entries[0]).toEqual({
      id: "entry-uuid-1",
      title: "Margherita Pizza",
      captured_at: "2026-01-01T12:00:00.000Z",
      thumbnail_url: "https://signed.example/place-uuid-1/photo-thumb.webp?token=abc",
      width: 800,
      height: 600,
    });
  });

  it("signs thumbnail URLs for an hour", async () => {
    const supabase = stubSupabase({ ...DINER, entries: [entry()] });

    await get();

    expect(supabase.storageFrom).toHaveBeenCalledWith("entry-photos");
    expect(supabase.createSignedUrls).toHaveBeenCalledWith(
      ["place-uuid-1/photo-thumb.webp"],
      3600,
    );
  });

  it("never exposes the full-resolution photo path", async () => {
    stubSupabase({ ...DINER, entries: [entry()] });

    const { body } = await get();

    expect(JSON.stringify(body)).not.toContain("photo_path");
  });

  it("orders dishes by most recently captured first", async () => {
    stubSupabase({
      ...DINER,
      entries: [
        entry({ id: "older", captured_at: "2026-01-01T12:00:00.000Z" }),
        entry({ id: "newer", captured_at: "2026-05-05T12:00:00.000Z" }),
      ],
    });

    const { body } = await get();

    expect(body.placeLog.entries.map((e: { id: string }) => e.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("caps the dishes it returns so one request never signs unboundedly many URLs", async () => {
    const entries = Array.from({ length: 60 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        thumbnail_path: `place-uuid-1/photo-${index}-thumb.webp`,
      }),
    );
    const supabase = stubSupabase({ ...DINER, entries });

    const { body } = await get();

    expect(body.placeLog.entries).toHaveLength(50);
    expect(supabase.createSignedUrls.mock.calls[0][0]).toHaveLength(50);
  });

  it("404s on a Place that doesn't exist", async () => {
    stubSupabase(null, { code: "PGRST116", message: "no rows" });

    const { response } = await get("nope");

    expect(response.status).toBe(404);
  });

  it("404s on a Place with no dishes logged at it", async () => {
    // A Place with no Entries is the residue of a failed save, not somewhere
    // anyone has eaten -- it has no pin, so it has no PlaceLog either.
    stubSupabase({ ...DINER, entries: [] });

    const { response } = await get();

    expect(response.status).toBe(404);
  });

  it("fails loudly when signing the thumbnails fails", async () => {
    const supabase = stubSupabase({ ...DINER, entries: [entry()] });
    supabase.createSignedUrls.mockResolvedValue({
      data: null,
      error: { message: "storage unavailable" },
    });

    const { response } = await get();

    expect(response.status).toBe(500);
  });
});
