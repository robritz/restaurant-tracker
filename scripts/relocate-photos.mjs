// Moves photo objects uploaded before Household-keyed paths (#37) under the
// prefix the rest of the bucket already uses, and points their Entry's two
// path columns at where they landed.
//
// Why a script and not a migration: the objects are not rows in a table the
// migration system owns, so a migration would be reaching outside its own
// world -- and a migration cannot be run against the hosted project as a
// dry run first. `npm run relocate:photos` is the honest shape (#50).
//
// Dry run by default. Nothing is copied, updated or deleted without
// `--apply`, because the stragglers that matter live in the hosted project.
// Both modes print the project they are pointed at before doing anything: the
// credentials come from an env file, and "wrong project" must not be silent.
//
// Re-runnable by design: every step checks for its own outcome before doing
// it, so a run interrupted anywhere can be finished by running it again.
// The order is copy, verify, update the row, delete the original -- never
// anything else. A copy that fails leaves an Entry pointing at the object it
// has always pointed at; a delete that fails leaves a duplicate, which the
// next run sweeps up. The one state this must never produce is an Entry whose
// paths name an object that is not there.
import { createClient } from "@supabase/supabase-js";
import { normalizeUrl, readEnv } from "./supabase-env.mjs";

// Restated rather than imported from `src/lib/photos.ts`: that is TypeScript
// and this runs under plain `node`. Renaming the bucket means changing both
// -- which is why the integration test for this script imports the real
// constant and asserts against the same bucket.
const PHOTO_BUCKET = "entry-photos";
const PAGE_SIZE = 500;

/**
 * What has to happen to one Entry, decided from the row alone.
 *
 * Both directions are derivable, which is what makes a half-applied run
 * recoverable: a legacy path gets the Household prefix added, and an
 * already-keyed path tells us where its original would have been, so the
 * leftover can be found and removed.
 */
export function planEntry(entry) {
  const prefix = `${entry.household_id}/`;
  const objects = ["photo_path", "thumbnail_path"].map((column) => {
    const current = entry[column];
    return current.startsWith(prefix)
      ? { column, legacy: current.slice(prefix.length), keyed: current }
      : { column, legacy: current, keyed: `${prefix}${current}` };
  });

  return {
    entryId: entry.id,
    householdId: entry.household_id,
    rowNeedsUpdate: objects.some((object) => object.keyed !== entry[object.column]),
    objects,
  };
}

/**
 * Carry out one plan against the bucket and the table.
 *
 * `deps` is the seam: `exists`, `copy`, `updatePaths` and `remove`. Injected
 * so the ordering this function is careful about can be asserted without a
 * Supabase project, and so a mistake in it fails a unit test rather than a
 * hosted bucket.
 *
 * Reports what it actually did rather than what the plan hoped for: `copied`
 * counts objects this run moved, so a run finishing an interrupted one says 0,
 * and `removed` counts originals deleted whether or not the row needed
 * repointing.
 */
export async function relocateEntry(deps, plan) {
  // Every object under its keyed path and verified there, before the row is
  // touched. `copy` reporting success is not enough -- the point of the
  // verify is that the row is only ever repointed at an object we have seen.
  let copied = 0;
  for (const object of plan.objects) {
    if (await deps.exists(object.keyed)) continue;
    await deps.copy(object.legacy, object.keyed);
    if (!(await deps.exists(object.keyed))) {
      throw new Error(
        `Copy of ${object.legacy} reported success but the object did not arrive at ${object.keyed}.`,
      );
    }
    copied += 1;
  }

  if (plan.rowNeedsUpdate) {
    // Built from each object's own column rather than by position, so the
    // pair cannot be swapped by a change to how a plan is assembled.
    const paths = {};
    for (const object of plan.objects) paths[object.column] = object.keyed;
    await deps.updatePaths(plan.entryId, paths);
  }

  // Only now, and only objects that are still there: a run interrupted
  // between the update and the delete leaves these behind, and this is the
  // sweep that finishes it.
  let removed = 0;
  for (const object of plan.objects) {
    if (object.legacy === object.keyed) continue;
    if (!(await deps.exists(object.legacy))) continue;
    await deps.remove([object.legacy]);
    removed += 1;
  }

  return { entryId: plan.entryId, copied, repointed: plan.rowNeedsUpdate, removed };
}

/**
 * Objects sitting under a legacy prefix that no Entry claims.
 *
 * The rest of this script works from `entries`, which cannot see these: an
 * upload that succeeded while its insert died leaves an object with no row,
 * and no row means no Household to file it under. They are reported and left
 * alone -- guessing which family's they are would be worse than saying so.
 */
export function unclaimedLegacyObjects(bucketPaths, plans) {
  const claimed = new Set();
  for (const plan of plans) {
    for (const object of plan.objects) {
      claimed.add(object.legacy);
      claimed.add(object.keyed);
    }
  }
  const householdIds = new Set(plans.map((plan) => plan.householdId));
  return bucketPaths.filter(
    (path) => !claimed.has(path) && !householdIds.has(path.split("/")[0]),
  );
}

/**
 * The service role, which here reads and writes a table as well as the
 * bucket. ADR 0005 confines that to storage *in request handlers*, where a
 * table read behind RLS's back is a hole; an operator script has no caller to
 * be subject to and must see every Household's Entries, as the seed does.
 */
export function serviceRoleClient() {
  return createClient(
    normalizeUrl(readEnv("SUPABASE_URL")),
    readEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * The bucket and table operations `relocateEntry` needs, against a real
 * project. Named for the pair on purpose: `updatePaths` writes `entries`, and
 * a name saying only "bucket" would hide exactly the line ADR 0005 draws.
 */
export function storageAndEntryDeps(supabase) {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  return {
    // Storage has no "does this object exist" call, so ask the directory for
    // its own name. `createSignedUrl` would sign a path with nothing behind
    // it, which is precisely the answer that must not be accepted.
    async exists(path) {
      const slash = path.lastIndexOf("/");
      const directory = slash < 0 ? "" : path.slice(0, slash);
      const name = path.slice(slash + 1);
      const { data, error } = await bucket.list(directory, { search: name, limit: 1 });
      if (error) throw new Error(`Unable to list ${path}: ${error.message}`);
      return data.some((object) => object.name === name);
    },
    async copy(from, to) {
      const { error } = await bucket.copy(from, to);
      if (error) throw new Error(`Unable to copy ${from} to ${to}: ${error.message}`);
    },
    async remove(paths) {
      const { error } = await bucket.remove(paths);
      if (error) throw new Error(`Unable to remove ${paths.join(", ")}: ${error.message}`);
    },
    async updatePaths(entryId, paths) {
      const { error } = await supabase.from("entries").update(paths).eq("id", entryId);
      if (error) throw new Error(`Unable to update entry ${entryId}: ${error.message}`);
    },
  };
}

async function readEntries(supabase) {
  const entries = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await supabase
      .from("entries")
      .select("id, household_id, photo_path, thumbnail_path")
      .order("id")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) {
      console.error("Unable to read entries:", error.message);
      process.exit(1);
    }
    entries.push(...data);
    if (data.length < PAGE_SIZE) return entries;
  }
}

/**
 * Every object path in the bucket, two levels deep -- which is every level
 * either layout uses: `<place>/<uuid>` or `<household>/<place>/<uuid>`.
 */
async function readBucketPaths(supabase) {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  async function list(prefix) {
    const { data, error } = await bucket.list(prefix, { limit: 1000 });
    if (error) throw new Error(`Unable to list ${prefix || "the bucket root"}: ${error.message}`);
    return data;
  }

  const paths = [];
  for (const top of await list("")) {
    for (const child of await list(top.name)) {
      // A folder has no id; an object does. Legacy objects sit one level down,
      // keyed ones two.
      if (child.id) paths.push(`${top.name}/${child.name}`);
      else {
        for (const leaf of await list(`${top.name}/${child.name}`)) {
          if (leaf.id) paths.push(`${top.name}/${child.name}/${leaf.name}`);
        }
      }
    }
  }
  return paths;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = serviceRoleClient();
  const deps = storageAndEntryDeps(supabase);

  // Before anything else: the project about to be read, and possibly written.
  console.log(`Project: ${normalizeUrl(readEnv("SUPABASE_URL"))}`);
  console.log(apply ? "Mode: apply\n" : "Mode: dry run\n");

  const plans = (await readEntries(supabase)).map(planEntry);
  const toMove = plans.filter((plan) => plan.rowNeedsUpdate);

  // Leftovers are only visible in the bucket, so finding them costs a lookup
  // per already-keyed Entry. Worth it: an orphan is exactly what nobody would
  // otherwise notice. Each leftover is recorded, not just the fact that one
  // exists, so the report names the objects that are really there rather than
  // both halves of a pair when only one survived.
  const toSweep = [];
  for (const plan of plans) {
    if (plan.rowNeedsUpdate) continue;
    const leftovers = [];
    for (const object of plan.objects) {
      if (object.legacy === object.keyed) continue;
      if (await deps.exists(object.legacy)) leftovers.push(object.legacy);
    }
    if (leftovers.length) toSweep.push({ plan, leftovers });
  }

  const unclaimed = unclaimedLegacyObjects(await readBucketPaths(supabase), plans);

  console.log(`${plans.length} ${plans.length === 1 ? "Entry" : "Entries"}.`);

  console.log(`\n${toMove.length} to move:`);
  for (const plan of toMove) {
    for (const object of plan.objects) {
      if (object.legacy !== object.keyed) console.log(`  ${object.legacy} -> ${object.keyed}`);
    }
  }

  // Said as a delete, because that is what it is: the Entry already points at
  // the keyed object, and what is left is the original.
  console.log(`\n${toSweep.length} with an original left behind, to delete:`);
  for (const { leftovers } of toSweep) {
    for (const path of leftovers) console.log(`  delete ${path}`);
  }

  if (unclaimed.length) {
    console.log(`\n${unclaimed.length} object(s) under a legacy prefix that no Entry claims.`);
    console.log("Left alone: with no Entry there is no Household to file them under.");
    for (const path of unclaimed) console.log(`  ${path}`);
  }

  if (!toMove.length && !toSweep.length) {
    console.log("\nNothing to do; every object an Entry points at is under its Household prefix.");
    return;
  }

  if (!apply) {
    console.log("\nDry run. Re-run with `--apply` to carry this out.");
    return;
  }

  let copied = 0;
  let repointed = 0;
  let removed = 0;
  const failed = [];
  for (const plan of [...toMove, ...toSweep.map((sweep) => sweep.plan)]) {
    try {
      const result = await relocateEntry(deps, plan);
      copied += result.copied;
      repointed += result.repointed ? 1 : 0;
      removed += result.removed;
    } catch (error) {
      // Keep going: one unreadable object should not strand the rest, and the
      // run is re-runnable, so the failures can be retried on their own.
      failed.push(plan.entryId);
      console.error(`  entry ${plan.entryId}: ${error.message}`);
    }
  }

  const entries = repointed === 1 ? "Entry" : "Entries";
  console.log(
    `\nCopied ${copied} object(s), repointed ${repointed} ${entries}, deleted ${removed}.`,
  );
  if (failed.length) {
    console.error(
      `\n${failed.length} ${failed.length === 1 ? "Entry" : "Entries"} did not finish: ${failed.join(", ")}`,
    );
    console.error("Each still points at an object that is there -- the worst a part-done");
    console.error("Entry leaves is a duplicate. Re-run to finish them.");
    process.exit(1);
  }
}

// Importable for its tests, runnable as a script: only the latter should do
// anything.
if (import.meta.url === `file://${process.argv[1]}`) await main();
