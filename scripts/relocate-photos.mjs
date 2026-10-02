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
//
// Re-runnable by design: every step checks for its own outcome before doing
// it, so a run interrupted anywhere can be finished by running it again.
// The order is copy, verify, update the row, delete the original -- never
// anything else. A copy that fails leaves an Entry pointing at the object it
// has always pointed at; a delete that fails leaves a duplicate, which the
// next run sweeps up. The one state this must never produce is an Entry whose
// paths name an object that is not there.
import { createClient } from "@supabase/supabase-js";

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
 */
export async function relocateEntry(deps, plan) {
  // Every object under its keyed path and verified there, before the row is
  // touched. `copy` reporting success is not enough -- the point of the
  // verify is that the row is only ever repointed at an object we have seen.
  for (const object of plan.objects) {
    if (await deps.exists(object.keyed)) continue;
    await deps.copy(object.legacy, object.keyed);
    if (!(await deps.exists(object.keyed))) {
      throw new Error(
        `Copy of ${object.legacy} reported success but the object did not arrive at ${object.keyed}.`,
      );
    }
  }

  let moved = 0;
  if (plan.rowNeedsUpdate) {
    await deps.updatePaths(plan.entryId, {
      photo_path: plan.objects[0].keyed,
      thumbnail_path: plan.objects[1].keyed,
    });
    moved = plan.objects.length;
  }

  // Only now, and only objects that are still there: a run interrupted
  // between the update and the delete leaves these behind, and this is the
  // sweep that finishes it.
  let cleaned = 0;
  for (const object of plan.objects) {
    if (object.legacy === object.keyed) continue;
    if (!(await deps.exists(object.legacy))) continue;
    await deps.remove([object.legacy]);
    if (!plan.rowNeedsUpdate) cleaned += 1;
  }

  return { entryId: plan.entryId, moved, cleaned };
}

function readEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Copy .env.local.example to .env.local and fill it in.");
    process.exit(1);
  }
  return value;
}

// Same defensive strip as src/lib/supabase/env.ts: `supabase status` prints
// API_URL next to REST_URL, and pasting the wrong one fails obscurely.
function normalizeUrl(url) {
  return url
    .replace(/\/(rest|auth|graphql|storage|functions)\/v1\/?$/, "")
    .replace(/\/$/, "");
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
 * Storage has no "does this object exist" call, so ask the directory for its
 * own name. `createSignedUrl` would sign a path with nothing behind it, which
 * is precisely the answer we must not accept.
 */
export function bucketDeps(supabase) {
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  return {
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

async function main() {
  const apply = process.argv.includes("--apply");
  const supabase = serviceRoleClient();
  const deps = bucketDeps(supabase);

  const plans = (await readEntries(supabase)).map(planEntry);
  const toMove = plans.filter((plan) => plan.rowNeedsUpdate);

  // Leftovers are only visible in the bucket, so finding them costs a lookup
  // per already-keyed Entry. Worth it: an orphan is exactly what nobody would
  // otherwise notice.
  const toSweep = [];
  for (const plan of plans) {
    if (plan.rowNeedsUpdate) continue;
    for (const object of plan.objects) {
      if (await deps.exists(object.legacy)) {
        toSweep.push(plan);
        break;
      }
    }
  }

  console.log(`${plans.length} Entries, ${toMove.length} to move, ${toSweep.length} with an original left behind.`);
  for (const plan of [...toMove, ...toSweep]) {
    for (const object of plan.objects) {
      if (object.legacy !== object.keyed) {
        console.log(`  ${object.legacy} -> ${object.keyed}`);
      }
    }
  }

  if (!toMove.length && !toSweep.length) {
    console.log("Nothing to do; every object is already under its Household prefix.");
    return;
  }

  if (!apply) {
    console.log("\nDry run. Re-run with `--apply` to carry this out.");
    return;
  }

  let moved = 0;
  let cleaned = 0;
  const failed = [];
  for (const plan of [...toMove, ...toSweep]) {
    try {
      const result = await relocateEntry(deps, plan);
      moved += result.moved;
      cleaned += result.cleaned;
    } catch (error) {
      // Keep going: one unreadable object should not strand the rest, and the
      // run is re-runnable, so the failures can be retried on their own.
      failed.push(plan.entryId);
      console.error(`  entry ${plan.entryId}: ${error.message}`);
    }
  }

  console.log(`Moved ${moved} objects, swept up ${cleaned}.`);
  if (failed.length) {
    console.error(`${failed.length} Entries were left as they were: ${failed.join(", ")}`);
    console.error("Nothing was half-applied; re-run to retry them.");
    process.exit(1);
  }
}

// Importable for its tests, runnable as a script: only the latter should do
// anything.
if (import.meta.url === `file://${process.argv[1]}`) await main();
