import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServiceRoleClient = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseServiceRoleClient: () => createSupabaseServiceRoleClient(),
}));

import { POST } from "./route";

const EXISTING_PLACE = {
  id: "place-uuid-1",
  mapbox_id: "mbx.1",
  name: "Test Diner",
  address: "123 Main St",
  latitude: 40.0,
  longitude: -73.0,
};

type SupabaseStub = {
  upsert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  storageFrom: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function stubSupabase(
  overrides: {
    place?: { data: unknown; error: unknown };
    entry?: { data: unknown; error: unknown };
    upload?: { data: unknown; error: unknown };
  } = {},
): SupabaseStub {
  const placeResult = overrides.place ?? { data: EXISTING_PLACE, error: null };
  const entryResult = overrides.entry ?? {
    data: {
      id: "entry-uuid-1",
      place_id: EXISTING_PLACE.id,
      title: "Margherita Pizza",
      photo_path: "place-uuid-1/photo.jpg",
      captured_at: "2026-01-01T12:00:00.000Z",
      created_at: "2026-09-11T00:00:00.000Z",
    },
    error: null,
  };
  const uploadResult = overrides.upload ?? {
    data: { path: "place-uuid-1/photo.jpg" },
    error: null,
  };

  const upsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(placeResult),
    }),
  });
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(entryResult),
    }),
  });
  const upload = vi.fn().mockResolvedValue(uploadResult);
  const remove = vi.fn().mockResolvedValue({ data: null, error: null });
  const storageFrom = vi.fn().mockReturnValue({ upload, remove });
  const from = vi.fn((table: string) =>
    table === "places" ? { upsert } : { insert },
  );

  createSupabaseServiceRoleClient.mockReturnValue({
    from,
    storage: { from: storageFrom },
  });

  return { upsert, insert, upload, remove, storageFrom, from };
}

function entryFormData(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("title", "Margherita Pizza");
  form.set("captured_at", "2026-01-01T12:00:00.000Z");
  form.set("mapbox_id", EXISTING_PLACE.mapbox_id);
  form.set("name", EXISTING_PLACE.name);
  form.set("address", EXISTING_PLACE.address);
  form.set("latitude", String(EXISTING_PLACE.latitude));
  form.set("longitude", String(EXISTING_PLACE.longitude));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === "") form.delete(key);
    else form.set(key, value);
  }
  form.set(
    "photo",
    new File([new Uint8Array([1, 2, 3])], "dish.jpg", { type: "image/jpeg" }),
  );
  return form;
}

async function post(form: FormData) {
  const response = await POST(
    new Request("http://localhost/api/entries", {
      method: "POST",
      body: form,
    }),
  );
  return { response, body: await response.json() };
}

describe("POST /api/entries", () => {
  beforeEach(() => {
    createSupabaseServiceRoleClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts the place on its Mapbox id so a repeat visit reuses one row", async () => {
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(supabase.upsert).toHaveBeenCalledWith(
      {
        mapbox_id: "mbx.1",
        name: "Test Diner",
        address: "123 Main St",
        latitude: 40.0,
        longitude: -73.0,
      },
      { onConflict: "mapbox_id" },
    );
  });

  it("uploads the photo to the entry photos bucket", async () => {
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(supabase.storageFrom).toHaveBeenCalledWith("entry-photos");
    const [path, file, options] = supabase.upload.mock.calls[0];
    expect(path).toMatch(/^place-uuid-1\/.+\.jpg$/);
    expect(file).toBeInstanceOf(File);
    expect(options).toMatchObject({ contentType: "image/jpeg" });
  });

  it("inserts the entry referencing the upserted place and the stored photo", async () => {
    const supabase = stubSupabase();

    await post(entryFormData());

    const uploadedPath = supabase.upload.mock.calls[0][0];
    expect(supabase.insert).toHaveBeenCalledWith({
      place_id: EXISTING_PLACE.id,
      title: "Margherita Pizza",
      photo_path: uploadedPath,
      captured_at: "2026-01-01T12:00:00.000Z",
    });
  });

  it("returns the created entry with its place", async () => {
    stubSupabase();

    const { response, body } = await post(entryFormData());

    expect(response.status).toBe(201);
    expect(body.entry).toMatchObject({
      id: "entry-uuid-1",
      title: "Margherita Pizza",
      photo_path: "place-uuid-1/photo.jpg",
      captured_at: "2026-01-01T12:00:00.000Z",
      place: {
        id: EXISTING_PLACE.id,
        mapbox_id: "mbx.1",
        name: "Test Diner",
      },
    });
  });

  it.each([
    ["title", "title"],
    ["mapbox_id", "mapbox_id"],
    ["captured_at", "captured_at"],
  ])("rejects a request missing %s", async (_label, field) => {
    stubSupabase();

    const { response } = await post(entryFormData({ [field]: "" }));

    expect(response.status).toBe(400);
  });

  it("rejects a request with no photo", async () => {
    stubSupabase();
    const form = entryFormData();
    form.delete("photo");

    const { response } = await post(form);

    expect(response.status).toBe(400);
  });

  it("rejects non-numeric coordinates", async () => {
    stubSupabase();

    const { response } = await post(entryFormData({ latitude: "not-a-number" }));

    expect(response.status).toBe(400);
  });

  it("fails loudly when the place upsert fails", async () => {
    stubSupabase({ place: { data: null, error: { message: "upsert failed" } } });

    const { response } = await post(entryFormData());

    expect(response.status).toBe(500);
  });

  it("fails loudly when the photo upload fails", async () => {
    const supabase = stubSupabase({
      upload: { data: null, error: { message: "upload failed" } },
    });

    const { response } = await post(entryFormData());

    expect(response.status).toBe(500);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("fails loudly when the entry insert fails", async () => {
    stubSupabase({ entry: { data: null, error: { message: "insert failed" } } });

    const { response } = await post(entryFormData());

    expect(response.status).toBe(500);
  });

  it("removes the uploaded photo when the entry insert fails", async () => {
    const supabase = stubSupabase({
      entry: { data: null, error: { message: "insert failed" } },
    });

    await post(entryFormData());

    const uploadedPath = supabase.upload.mock.calls[0][0];
    expect(supabase.remove).toHaveBeenCalledWith([uploadedPath]);
  });
});
