-- A Household is the family that owns what is tracked here -- not a person
-- (see CONTEXT.md and docs/adr/0004-household-owns-entries.md). Credentials
-- join a Household through household_members rather than owning rows
-- directly, so a second phone can join the same map later without sharing a
-- password.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Every policy below answers "which Households is the caller in?", which is a
-- lookup by user_id, not by the primary key's leading column.
create index household_members_user_id_idx on public.household_members (user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- SECURITY DEFINER to break the recursion: a policy on household_members that
-- queried household_members directly would re-enter its own policy forever.
-- Reading the table from inside a definer function bypasses RLS, which is
-- safe because the function only ever reveals the caller's own memberships.
-- Empty search_path so an unqualified name can't be hijacked by a caller's
-- search_path.
create function public.household_ids_for_current_user()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = (select auth.uid());
$$;

revoke execute on function public.household_ids_for_current_user() from public, anon;
grant execute on function public.household_ids_for_current_user() to authenticated;

-- Read-only for members. Households and memberships are created by the seed
-- running as the service role; nothing in the app creates them yet, and
-- there is no self-signup (see the spec on issue #34).
create policy "Members read their own Household"
  on public.households
  for select
  to authenticated
  using (id in (select public.household_ids_for_current_user()));

create policy "Members read their own Household's memberships"
  on public.household_members
  for select
  to authenticated
  using (household_id in (select public.household_ids_for_current_user()));
