import { describe, expect, it } from "vitest";
import { planEntry, relocateEntry, unclaimedLegacyObjects } from "./relocate-photos.mjs";

const HOUSEHOLD = "household-1";

function entry(overrides = {}) {
  return {
    id: "entry-1",
    household_id: HOUSEHOLD,
    photo_path: "place-1/abc.jpg",
    thumbnail_path: "place-1/abc-thumb.webp",
    ...overrides,
  };
}

/**
 * The storage bucket and the `entries` table, as a pair of in-memory fakes
 * that record every call in order. The order is the point: a copy that is
 * never verified, or a delete that happens before the row is updated, is
 * exactly the half-applied state this script exists to avoid, and only the
 * sequence shows it.
 */
function fakeWorld(existing = []) {
  const objects = new Set(existing);
  const calls = [];
  const rows = {};
  return {
    calls,
    objects,
    rows,
    deps: {
      async exists(path) {
        calls.push(["exists", path]);
        return objects.has(path);
      },
      async copy(from, to) {
        calls.push(["copy", from, to]);
        if (!objects.has(from)) throw new Error(`no object at ${from}`);
        objects.add(to);
      },
      async updatePaths(entryId, paths) {
        calls.push(["update", entryId, paths]);
        rows[entryId] = paths;
      },
      async remove(paths) {
        calls.push(["remove", ...paths]);
        for (const path of paths) objects.delete(path);
      },
    },
  };
}

describe("planEntry", () => {
  it("prefixes a pre-Household path with its Household", () => {
    const plan = planEntry(entry());

    expect(plan).toEqual({
      entryId: "entry-1",
      householdId: HOUSEHOLD,
      rowNeedsUpdate: true,
      objects: [
        {
          column: "photo_path",
          legacy: "place-1/abc.jpg",
          keyed: `${HOUSEHOLD}/place-1/abc.jpg`,
        },
        {
          column: "thumbnail_path",
          legacy: "place-1/abc-thumb.webp",
          keyed: `${HOUSEHOLD}/place-1/abc-thumb.webp`,
        },
      ],
    });
  });

  it("leaves an already-keyed path alone, and derives where its old object was", () => {
    const plan = planEntry(
      entry({
        photo_path: `${HOUSEHOLD}/place-1/abc.jpg`,
        thumbnail_path: `${HOUSEHOLD}/place-1/abc-thumb.webp`,
      }),
    );

    expect(plan.rowNeedsUpdate).toBe(false);
    expect(plan.objects[0]).toEqual({
      column: "photo_path",
      legacy: "place-1/abc.jpg",
      keyed: `${HOUSEHOLD}/place-1/abc.jpg`,
    });
  });

  it("treats an Entry whose columns disagree as still needing the update", () => {
    // The shape an interrupted run leaves if it ever updated one column
    // without the other.
    const plan = planEntry(
      entry({ photo_path: `${HOUSEHOLD}/place-1/abc.jpg` }),
    );

    expect(plan.rowNeedsUpdate).toBe(true);
    expect(plan.objects.map((object) => object.keyed)).toEqual([
      `${HOUSEHOLD}/place-1/abc.jpg`,
      `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    ]);
  });
});

describe("unclaimedLegacyObjects", () => {
  const plans = [planEntry(entry())];

  it("ignores objects an Entry accounts for, under either layout", () => {
    expect(
      unclaimedLegacyObjects(
        [
          "place-1/abc.jpg",
          "place-1/abc-thumb.webp",
          `${HOUSEHOLD}/place-1/abc.jpg`,
          `${HOUSEHOLD}/place-1/abc-thumb.webp`,
        ],
        plans,
      ),
    ).toEqual([]);
  });

  it("names a legacy object no Entry points at", () => {
    // An upload whose insert died: no row, so no Household to file it under.
    expect(unclaimedLegacyObjects(["place-9/orphan.jpg"], plans)).toEqual([
      "place-9/orphan.jpg",
    ]);
  });

  it("does not accuse an already-keyed object of being an orphan", () => {
    // Under a Household prefix and belonging to an Entry this run did not
    // read -- a Household with no legacy Entries at all. Reporting it would
    // send the operator looking for a problem that is not there.
    expect(
      unclaimedLegacyObjects([`${HOUSEHOLD}/place-9/other.jpg`], plans),
    ).toEqual([]);
  });
});

describe("relocateEntry", () => {
  it("copies, verifies, updates the row, and only then deletes the originals", async () => {
    const world = fakeWorld(["place-1/abc.jpg", "place-1/abc-thumb.webp"]);

    const result = await relocateEntry(world.deps, planEntry(entry()));

    expect(result).toEqual({ entryId: "entry-1", copied: 2, repointed: true, removed: 2 });
    expect(world.calls).toEqual([
      ["exists", `${HOUSEHOLD}/place-1/abc.jpg`],
      ["copy", "place-1/abc.jpg", `${HOUSEHOLD}/place-1/abc.jpg`],
      ["exists", `${HOUSEHOLD}/place-1/abc.jpg`],
      ["exists", `${HOUSEHOLD}/place-1/abc-thumb.webp`],
      ["copy", "place-1/abc-thumb.webp", `${HOUSEHOLD}/place-1/abc-thumb.webp`],
      ["exists", `${HOUSEHOLD}/place-1/abc-thumb.webp`],
      [
        "update",
        "entry-1",
        {
          photo_path: `${HOUSEHOLD}/place-1/abc.jpg`,
          thumbnail_path: `${HOUSEHOLD}/place-1/abc-thumb.webp`,
        },
      ],
      ["exists", "place-1/abc.jpg"],
      ["remove", "place-1/abc.jpg"],
      ["exists", "place-1/abc-thumb.webp"],
      ["remove", "place-1/abc-thumb.webp"],
    ]);
    expect([...world.objects]).toEqual([
      `${HOUSEHOLD}/place-1/abc.jpg`,
      `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    ]);
  });

  it("leaves the row and the original alone when the copy fails", async () => {
    const world = fakeWorld(["place-1/abc.jpg"]);

    await expect(
      relocateEntry(world.deps, planEntry(entry())),
    ).rejects.toThrow(/place-1\/abc-thumb\.webp/);

    expect(world.rows).toEqual({});
    expect(world.objects.has("place-1/abc.jpg")).toBe(true);
  });

  it("refuses to update the row if a copy reported success but the object is not there", async () => {
    const world = fakeWorld(["place-1/abc.jpg", "place-1/abc-thumb.webp"]);
    world.deps.copy = async () => {}; // silent no-op, the worst kind of success

    await expect(
      relocateEntry(world.deps, planEntry(entry())),
    ).rejects.toThrow(/did not arrive/);

    expect(world.rows).toEqual({});
    expect(world.objects.has("place-1/abc.jpg")).toBe(true);
  });

  it("finishes a run interrupted after the copies", async () => {
    const world = fakeWorld([
      "place-1/abc.jpg",
      "place-1/abc-thumb.webp",
      `${HOUSEHOLD}/place-1/abc.jpg`,
      `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    ]);

    const result = await relocateEntry(world.deps, planEntry(entry()));

    // Nothing to copy -- the previous run already did that, which is exactly
    // what the count must say.
    expect(result).toEqual({ entryId: "entry-1", copied: 0, repointed: true, removed: 2 });
    expect(world.calls.filter(([name]) => name === "copy")).toEqual([]);
    expect(world.rows["entry-1"]).toEqual({
      photo_path: `${HOUSEHOLD}/place-1/abc.jpg`,
      thumbnail_path: `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    });
    expect([...world.objects]).toEqual([
      `${HOUSEHOLD}/place-1/abc.jpg`,
      `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    ]);
  });

  it("sweeps up an original left behind after the row was already updated", async () => {
    const world = fakeWorld([
      "place-1/abc.jpg",
      `${HOUSEHOLD}/place-1/abc.jpg`,
      `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    ]);

    const result = await relocateEntry(
      world.deps,
      planEntry(
        entry({
          photo_path: `${HOUSEHOLD}/place-1/abc.jpg`,
          thumbnail_path: `${HOUSEHOLD}/place-1/abc-thumb.webp`,
        }),
      ),
    );

    expect(result).toEqual({ entryId: "entry-1", copied: 0, repointed: false, removed: 1 });
    expect(world.rows).toEqual({});
    expect(world.objects.has("place-1/abc.jpg")).toBe(false);
  });

  it("changes nothing on an Entry that is already done", async () => {
    const world = fakeWorld([
      `${HOUSEHOLD}/place-1/abc.jpg`,
      `${HOUSEHOLD}/place-1/abc-thumb.webp`,
    ]);

    const result = await relocateEntry(
      world.deps,
      planEntry(
        entry({
          photo_path: `${HOUSEHOLD}/place-1/abc.jpg`,
          thumbnail_path: `${HOUSEHOLD}/place-1/abc-thumb.webp`,
        }),
      ),
    );

    expect(result).toEqual({ entryId: "entry-1", copied: 0, repointed: false, removed: 0 });
    expect(world.calls.some(([name]) => name !== "exists")).toBe(false);
  });
});
