-- A Household has one admin: the account it was seeded with. The admin
-- invites and removes whoever they like; everyone else can only remove
-- themselves, which is how a phone leaves without needing to ask.
--
-- Before this, every member could remove every other. That is fine for two
-- people who trust each other and wrong the moment a Household has three:
-- an invited phone could remove the account that invited it.

alter table public.household_members
  add column role text not null default 'member'
  check (role in ('admin', 'member'));

-- The account a Household was created with is its admin. Earliest membership
-- per Household, with user_id breaking a tie so the choice is deterministic
-- rather than whatever order the planner returns.
with first_member as (
  select distinct on (household_id) household_id, user_id
  from public.household_members
  order by household_id, created_at, user_id
)
update public.household_members m
set role = 'admin'
from first_member f
where m.household_id = f.household_id
  and m.user_id = f.user_id;

-- Reads "which Households does the caller run?", the way
-- household_ids_for_current_user() reads "which is the caller in?". Same
-- SECURITY DEFINER reasoning: a policy on household_members that queried
-- household_members would re-enter its own policy forever.
create function public.admin_household_ids_for_current_user()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_members
  where user_id = (select auth.uid())
    and role = 'admin';
$$;

revoke execute on function public.admin_household_ids_for_current_user() from public, anon;
grant execute on function public.admin_household_ids_for_current_user() to authenticated;

-- ---------------------------------------------------------------------------
-- Inviting is the admin's
-- ---------------------------------------------------------------------------

drop policy "Members issue invites into their own Household" on public.household_invites;
drop policy "Members revoke their Household's invites" on public.household_invites;
drop policy "Members read their Household's invites" on public.household_invites;

create policy "An admin issues invites into their own Household"
  on public.household_invites
  for insert
  to authenticated
  with check (household_id in (select public.admin_household_ids_for_current_user()));

create policy "An admin revokes their Household's invites"
  on public.household_invites
  for delete
  to authenticated
  using (household_id in (select public.admin_household_ids_for_current_user()));

-- Read by the same people who can act on them. A member who can neither
-- issue nor revoke an invite has no use for a list of them.
create policy "An admin reads their Household's invites"
  on public.household_invites
  for select
  to authenticated
  using (household_id in (select public.admin_household_ids_for_current_user()));

-- ---------------------------------------------------------------------------
-- Removing a member
-- ---------------------------------------------------------------------------

drop policy "Members remove another member" on public.household_members;

-- Two permissive policies, OR'd: the admin removes others, anyone else
-- removes themselves. Between them the admin cannot remove themselves --
-- the first excludes it and the second refuses an admin -- so a Household
-- always keeps the account that runs it, and can never be stranded with
-- Entries nobody can reach.
create policy "An admin removes anyone but themselves"
  on public.household_members
  for delete
  to authenticated
  using (
    household_id in (select public.admin_household_ids_for_current_user())
    and user_id <> (select auth.uid())
  );

create policy "A member removes themselves"
  on public.household_members
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and role <> 'admin'
    and household_id in (select public.household_ids_for_current_user())
  );

-- ---------------------------------------------------------------------------
-- Who is in my Household, and who runs it
-- ---------------------------------------------------------------------------

drop function public.household_members_for_current_user();

create function public.household_members_for_current_user()
returns table (user_id uuid, email text, joined_at timestamptz, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.created_at, m.role
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id in (select public.household_ids_for_current_user())
  order by m.created_at;
$$;

revoke execute on function public.household_members_for_current_user() from public, anon;
grant execute on function public.household_members_for_current_user() to authenticated;

-- A redeemed invite always joins as a plain member. Stated rather than left
-- to the column default, because this is the rule, not a convenience.
create or replace function public.accept_household_invite(p_token_hash text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  joined uuid;
  claimer uuid := (select auth.uid());
begin
  if claimer is null then
    return null;
  end if;

  if exists (select 1 from public.household_members where user_id = claimer) then
    return null;
  end if;

  update public.household_invites
  set accepted_at = now()
  where token_hash = p_token_hash
    and accepted_at is null
    and expires_at > now()
  returning household_id into joined;

  if joined is null then
    return null;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (joined, claimer, 'member')
  on conflict do nothing;

  return joined;
end
$$;

revoke execute on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The caller's own membership
-- ---------------------------------------------------------------------------

-- requireHousehold() used to read this straight off household_members with
-- `limit(1)`, on the stated grounds that RLS "shows a caller only their own
-- memberships". That was never true -- the select policy is household-wide,
-- so a caller sees every member of their Household -- and it was merely
-- harmless while every Household had exactly one member. With a second phone
-- and a role column it is not: `limit(1)` returns an arbitrary member's row,
-- so a plain member could read back the admin's role.
--
-- A definer function keyed on auth.uid() makes "the caller's own membership"
-- something the database answers, rather than something a filter has to
-- remember to ask for.
create function public.current_household_membership()
returns table (user_id uuid, household_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.household_id, m.role
  from public.household_members m
  where m.user_id = (select auth.uid())
  limit 1;
$$;

revoke execute on function public.current_household_membership() from public, anon;
grant execute on function public.current_household_membership() to authenticated;
