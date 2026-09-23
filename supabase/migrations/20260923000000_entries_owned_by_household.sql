-- The other half of accounts: the login gate landed in
-- 20260916000000_households.sql, but Entries still belonged to nobody. This
-- gives every Entry a Household and makes the database -- not the routes --
-- the thing that keeps one Household's dishes away from another's
-- (docs/adr/0004-household-owns-entries.md).

-- NOT NULL with no backfill, for the same reason the thumbnail columns took
-- that route in 20260911010000: there is no data worth preserving, so the
-- database is reset rather than backfilled. An Entry that belongs to nobody
-- is exactly the state this migration exists to make unrepresentable, so a
-- nullable column with a "shouldn't happen" branch above it would defeat it.
alter table public.entries
  add column household_id uuid not null references public.households (id);

-- Every read below filters on household_id first; place_id narrows what is
-- left. The existing entries_place_id_idx stays: the Place-side foreign key
-- still needs it.
create index entries_household_id_place_id_idx
  on public.entries (household_id, place_id);

-- ---------------------------------------------------------------------------
-- Entries: visible only to the Household that recorded them.
-- ---------------------------------------------------------------------------

-- This is what makes a route that forgets to filter unable to leak anything
-- (issue #34, story 28). It is also what makes the inner join in
-- /api/place-logs correct without the route saying a word about ownership:
-- Entries the caller cannot see do not exist to the join, so a Place where
-- only another Household has eaten produces no Pin (story 15).
create policy "A Household reads its own Entries"
  on public.entries
  for select
  to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

-- with check, not using: this is the constraint that an Entry cannot be
-- written into a Household the caller is not in. Passing someone else's
-- household_id fails here rather than succeeding quietly.
create policy "A Household records its own Entries"
  on public.entries
  for insert
  to authenticated
  with check (household_id in (select public.household_ids_for_current_user()));

-- No update or delete policy: nothing in the app edits or removes an Entry
-- yet. These arrive with the features that need them, rather than granting
-- reach now for a caller that never uses it.

-- ---------------------------------------------------------------------------
-- Places: shared reference data nobody owns
-- (docs/adr/0001-shared-deduped-place.md).
-- ---------------------------------------------------------------------------

-- Readable by any signed-in caller, which is what lets a search find a
-- restaurant another family recorded first (story 21). A Place carries a
-- name, an address and a point -- nothing about who ate there -- so sharing
-- the row reveals nothing about anyone's Entries.
create policy "Signed-in callers read Places"
  on public.places
  for select
  to authenticated
  using (true);

create policy "Signed-in callers record a new Place"
  on public.places
  for insert
  to authenticated
  with check (true);

-- Deliberately no update and no delete policy, for anyone. A Place is shared,
-- so an edit by one Household would silently rewrite the name and address
-- under every other Household's Pins (story 22). The absence of the policy is
-- the enforcement: POST /api/entries therefore resolves a Place with
-- ON CONFLICT DO NOTHING rather than an upsert, which would need update.
