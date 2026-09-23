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
 *
 * The Place is read with the RLS-enforced client and the thumbnails are
 * signed with the service role, so the two are stubbed separately. `entries`
 * here is what the caller's Household can see -- another Household's dishes
 * at the same Place never appear in it.
 */
function stubSupabase(
  place: (typeof DINER & { entries: EntryRow[] }) | null,
  error: unknown = null,
) {
  const single = vi.fn().mockResolvedValue({ data: place, error });
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ order });
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

  requireHousehold.mockResolvedValue({ supabase: { from }, householdId: HOUSEHOLD_ID });
  createSupabaseServiceRoleClient.mockReturnValue({
    storage: { from: storageFrom },
  });

  return { from, select, eq, order, limit, createSignedUrls, storageFrom };
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
    requireHousehold.mockReset();
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

  it("pairs each dish with its own URL, whatever order the signer answers in", async () => {
    const supabase = stubSupabase({
      ...DINER,
      entries: [
        entry({ id: "pizza", thumbnail_path: "p/pizza-thumb.webp" }),
        entry({
          id: "gelato",
          captured_at: "2025-12-01T12:00:00.000Z",
          thumbnail_path: "p/gelato-thumb.webp",
        }),
      ],
    });
    // Supabase documents no ordering for createSignedUrls, so the route
    // must not read it positionally -- a mismatch would caption one dish
    // with another's photo.
    supabase.createSignedUrls.mockResolvedValue({
      data: [
        {
          path: "p/gelato-thumb.webp",
          signedUrl: "https://signed.example/gelato",
          error: null,
        },
        {
          path: "p/pizza-thumb.webp",
          signedUrl: "https://signed.example/pizza",
          error: null,
        },
      ],
      error: null,
    });

    const { body } = await get();

    expect(
      body.placeLog.entries.map(
        (dish: { id: string; thumbnail_url: string }) => [
          dish.id,
          dish.thumbnail_url,
        ],
      ),
    ).toEqual([
      ["pizza", "https://signed.example/pizza"],
      ["gelato", "https://signed.example/gelato"],
    ]);
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

  it("asks the database for the newest dishes, capped, rather than filtering them here", async () => {
    // A Place with hundreds of dishes shouldn't fetch hundreds of rows to
    // throw most of them away.
    const supabase = stubSupabase({ ...DINER, entries: [entry()] });

    await get();

    expect(supabase.order).toHaveBeenCalledWith("captured_at", {
      referencedTable: "entries",
      ascending: false,
    });
    expect(supabase.limit).toHaveBeenCalledWith(50, {
      referencedTable: "entries",
    });
  });

  it("fails loudly when the credential belongs to no Household", async () => {
    // Distinct from the 404s below: those mean "no PlaceLog here", this
    // means the sign-in itself is not attached to anything.
    stubSupabase({ ...DINER, entries: [entry()] });
    requireHousehold.mockResolvedValue(null);

    const { response, body } = await get();

    expect(response.status).toBe(500);
    expect(body.error).toBe(NO_HOUSEHOLD_MESSAGE);
  });

  it("404s on a Place that doesn't exist", async () => {
    stubSupabase(null, { code: "PGRST116", message: "no rows" });

    const { response } = await get("nope");

    expect(response.status).toBe(404);
  });

  it("reads the dishes as the caller, not as the service role", async () => {
    // Story 16: the gallery answers "what have *we* eaten here?". It does so
    // because the Entries are read under RLS -- the service role would
    // answer "what has anyone eaten here?" and leak the difference.
    stubSupabase({ ...DINER, entries: [entry()] });

    await get();

    expect(requireHousehold).toHaveBeenCalled();
  });

  it("404s on a shared Place where only another Household has eaten", async () => {
    // RLS leaves the Place readable -- Places are shared -- but hides their
    // Entries, so the Place arrives carrying none. Indistinguishable from a
    // Place nobody has eaten at, which is the point: the response must not
    // reveal that somebody else's dishes are there (stories 17 and 18).
    const supabase = stubSupabase({ ...DINER, entries: [] });

    const { response, body } = await get();

    expect(response.status).toBe(404);
    expect(body.error).toBe("No place log found.");
    expect(supabase.createSignedUrls).not.toHaveBeenCalled();
  });

  it("404s on a Place with no dishes logged at it", async () => {
    // A Place with no Entries is the residue of a failed save, not somewhere
    // anyone has eaten -- it has no pin, so it has no PlaceLog either.
    stubSupabase({ ...DINER, entries: [] });

    const { response } = await get();

    expect(response.status).toBe(404);
  });

  it("fails loudly when a dish's thumbnail is missing from the signer's answer", async () => {
    const supabase = stubSupabase({ ...DINER, entries: [entry()] });
    supabase.createSignedUrls.mockResolvedValue({
      data: [
        {
          path: "somewhere/else-thumb.webp",
          signedUrl: "https://signed.example/else",
          error: null,
        },
      ],
      error: null,
    });

    const { response } = await get();

    expect(response.status).toBe(500);
  });

  it("fails loudly when the signer answers with no URL for a dish", async () => {
    const supabase = stubSupabase({ ...DINER, entries: [entry()] });
    supabase.createSignedUrls.mockResolvedValue({
      data: [
        {
          path: "place-uuid-1/photo-thumb.webp",
          signedUrl: null,
          error: "Object not found",
        },
      ],
      error: null,
    });

    const { response } = await get();

    expect(response.status).toBe(500);
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
