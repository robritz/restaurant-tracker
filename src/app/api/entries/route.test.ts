import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

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

import { POST } from "./route";
import { NO_HOUSEHOLD_MESSAGE } from "@/lib/auth/household";

const HOUSEHOLD_ID = "household-uuid-1";

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
  placeSelect: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  storageFrom: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

/**
 * Two clients, matching the route. Rows -- the Household lookup, the Place,
 * the Entry -- go through the RLS-enforced client; only the bucket uses the
 * service role (docs/adr/0005-service-role-for-storage-only.md).
 *
 * `household` defaults to a caller who is in one Household, which is what
 * the seed always produces.
 */
function stubSupabase(
  overrides: {
    place?: { data: unknown; error: unknown };
    placeInsert?: { error: unknown };
    entry?: { data: unknown; error: unknown };
    upload?: { data: unknown; error: unknown };
    /** false stands for a caller who belongs to no Household. */
    household?: false;
  } = {},
): SupabaseStub {
  const placeResult = overrides.place ?? { data: EXISTING_PLACE, error: null };
  const placeInsertResult = overrides.placeInsert ?? { error: null };
  const entryResult = overrides.entry ?? {
    data: {
      id: "entry-uuid-1",
      household_id: HOUSEHOLD_ID,
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

  // Awaited directly: ON CONFLICT DO NOTHING returns no row, so the route
  // reads the Place back through placeSelect rather than off the insert.
  const upsert = vi.fn().mockResolvedValue(placeInsertResult);
  const placeSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue(placeResult),
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
    table === "places" ? { upsert, select: placeSelect } : { insert },
  );

  requireHousehold.mockResolvedValue(
    overrides.household === false
      ? null
      : { supabase: { from }, householdId: HOUSEHOLD_ID },
  );
  createSupabaseServiceRoleClient.mockReturnValue({
    storage: { from: storageFrom },
  });

  return { upsert, placeSelect, insert, upload, remove, storageFrom, from };
}

/**
 * Real JPEGs, because the route runs sharp for real rather than mocking it
 * -- a fake byte string would fail to decode. Generating them with sharp
 * keeps binary fixtures out of the repo.
 */
async function jpeg(
  width: number,
  height: number,
  orientation?: number,
): Promise<File> {
  let image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 60 },
    },
  });
  if (orientation !== undefined) image = image.withMetadata({ orientation });
  const buffer = await image.jpeg().toBuffer();
  return new File([new Uint8Array(buffer)], "dish.jpg", { type: "image/jpeg" });
}

// One landscape photo reused by every test that doesn't care about the
// image itself. Encoding is slow enough to be worth doing once.
const LANDSCAPE = await jpeg(1600, 900);

function entryFormData(
  overrides: Record<string, string> = {},
  photo: File = LANDSCAPE,
) {
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
  form.set("photo", photo);
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
    requireHousehold.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the place on its Mapbox id so a repeat visit reuses one row", async () => {
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
      { onConflict: "mapbox_id", ignoreDuplicates: true },
    );
  });

  it("never overwrites a Place another Household recorded first", async () => {
    // ignoreDuplicates is ON CONFLICT DO NOTHING. It is not a style choice:
    // `places` grants update to nobody, so the plain upsert this replaced
    // is refused by RLS outright -- every repeat visit to a known restaurant
    // would fail. Leaving the row alone is also what story 22 asks for, so
    // a shared Place's name and address cannot change under anyone's Pins.
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(supabase.upsert.mock.calls[0][1]).toMatchObject({
      ignoreDuplicates: true,
    });
  });

  it("reads the Place back rather than trusting the insert to return it", async () => {
    // DO NOTHING returns no row on conflict, which is the common case: the
    // restaurant is usually already known. The read-back is the only branch
    // that answers both that and the first-ever visit.
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(supabase.placeSelect).toHaveBeenCalled();
  });

  it("uploads the photo to the entry photos bucket", async () => {
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(supabase.storageFrom).toHaveBeenCalledWith("entry-photos");
    const [path, file, options] = supabase.upload.mock.calls[0];
    // Household first, then Place: everything one family uploaded sits under
    // a single prefix, so removing their data later is a prefix delete.
    expect(path).toMatch(/^household-uuid-1\/place-uuid-1\/.+\.jpg$/);
    expect(file).toBeInstanceOf(File);
    expect(options).toMatchObject({ contentType: "image/jpeg" });
  });

  it("stores a thumbnail alongside the original photo", async () => {
    const supabase = stubSupabase();

    await post(entryFormData());

    const paths = supabase.upload.mock.calls.map((call: unknown[]) => call[0]);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toMatch(/\.webp$/);
    const [, , options] = supabase.upload.mock.calls[1];
    expect(options).toMatchObject({ contentType: "image/webp" });
  });

  it("records the thumbnail's dimensions upright, honouring EXIF orientation", async () => {
    const supabase = stubSupabase();

    // Stored 1600x900 but tagged orientation 6 ("rotate 90° to display"), so
    // upright it is 900x1600 -- which at 800px on the long edge is 450x800.
    // Without the rotate it would come out 800x450 and every portrait photo
    // in the gallery would be sideways.
    await post(entryFormData({}, await jpeg(1600, 900, 6)));

    expect(supabase.insert.mock.calls[0][0]).toMatchObject({
      width: 450,
      height: 800,
    });
  });

  it("inserts the entry referencing the resolved place and the stored photo", async () => {
    const supabase = stubSupabase();

    await post(entryFormData());

    const [uploadedPath, thumbnailPath] = supabase.upload.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    // The landscape fixture is 1600x900, so 800px on the long edge is 800x450.
    expect(supabase.insert).toHaveBeenCalledWith({
      household_id: HOUSEHOLD_ID,
      place_id: EXISTING_PLACE.id,
      title: "Margherita Pizza",
      photo_path: uploadedPath,
      thumbnail_path: thumbnailPath,
      width: 800,
      height: 450,
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

  it("records the Entry as the caller's Household", async () => {
    // Story 14: the dish belongs to the family, not to whichever phone
    // uploaded it. The household_id comes from the caller's membership, not
    // from anything in the request -- the form has no field for it.
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(supabase.insert.mock.calls[0][0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
    });
  });

  it("takes the Household from the session, not from the request", async () => {
    // A form field claiming a different Household must change nothing. The
    // insert policy would refuse a forged id anyway, but the route should
    // never be the thing carrying it in the first place.
    const supabase = stubSupabase();

    await post(entryFormData({ household_id: "someone-elses-household" }));

    expect(supabase.insert.mock.calls[0][0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
    });
  });

  it("writes the rows as the caller and uses the service role only for the bucket", async () => {
    // The division ADR-0005 draws. If the Entry insert ran as the service
    // role it would bypass the very policy that makes ownership real.
    const supabase = stubSupabase();

    await post(entryFormData());

    expect(requireHousehold).toHaveBeenCalled();
    expect(supabase.from).toHaveBeenCalledWith("entries");
    expect(supabase.storageFrom).toHaveBeenCalledWith("entry-photos");
  });

  it("fails loudly when the credential belongs to no Household", async () => {
    // A half-provisioned database, not a bad request: the seed creates the
    // identity and its Household together.
    stubSupabase({ household: false });

    const { response, body } = await post(entryFormData());

    expect(response.status).toBe(500);
    expect(body.error).toBe(NO_HOUSEHOLD_MESSAGE);
  });

  it("uploads nothing when the credential belongs to no Household", async () => {
    // Checked before the bucket is touched, so a failure here cannot strand
    // photos with no Entry to reference them.
    const supabase = stubSupabase({ household: false });

    await post(entryFormData());

    expect(supabase.upload).not.toHaveBeenCalled();
    expect(supabase.insert).not.toHaveBeenCalled();
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

  it("removes both uploaded photos when the entry insert fails", async () => {
    const supabase = stubSupabase({
      entry: { data: null, error: { message: "insert failed" } },
    });

    await post(entryFormData());

    const paths = supabase.upload.mock.calls.map((call: unknown[]) => call[0]);
    expect(supabase.remove).toHaveBeenCalledWith(paths);
  });

  it("rejects a photo that is not a readable image", async () => {
    stubSupabase();
    const form = entryFormData(
      {},
      new File([new Uint8Array([1, 2, 3])], "dish.jpg", { type: "image/jpeg" }),
    );

    const { response } = await post(form);

    expect(response.status).toBe(400);
  });

  it("writes nothing when the photo is not a readable image", async () => {
    const supabase = stubSupabase();

    await post(
      entryFormData(
        {},
        new File([new Uint8Array([1, 2, 3])], "dish.jpg", {
          type: "image/jpeg",
        }),
      ),
    );

    expect(supabase.upsert).not.toHaveBeenCalled();
    expect(supabase.upload).not.toHaveBeenCalled();
  });
});
