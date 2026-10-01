-- A second credential joins an existing Household by invitation from someone
-- already in it (issue #49). Self-signup stays off: the invite is the only
-- way in, and it is issued by a member, scoped to their Household, single-use
-- and expiring.

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- The hash, never the token. A row therefore cannot be redeemed by whoever
  -- reads it; the token exists only in the link the issuer copies.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Kept rather than deleted on use, so a spent invite reads as spent.
  accepted_at timestamptz
);

create index household_invites_household_id_idx
  on public.household_invites (household_id);

alter table public.household_invites enable row level security;

create policy "Members read their Household's invites"
  on public.household_invites
  for select
  to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

-- with check, not using: an invite cannot be issued into a Household the
-- caller is not in, which is what stops an invite reaching anyone else's map
-- (story 6).
create policy "Members issue invites into their own Household"
  on public.household_invites
  for insert
  to authenticated
  with check (household_id in (select public.household_ids_for_current_user()));

-- Revoking an invite is deleting it. No update policy: accepted_at is set
-- only by accept_household_invite() below, so "single use" cannot be undone
-- by rewriting the row.
create policy "Members revoke their Household's invites"
  on public.household_invites
  for delete
  to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

-- ---------------------------------------------------------------------------
-- Revoking a membership
-- ---------------------------------------------------------------------------

-- Access ends the moment the row goes: every policy in this schema reads
-- membership live, so there is no cached grant to expire (story 4).
--
-- Not yourself. Signing out is how you leave; this is how you remove someone
-- else's phone. It also means a Household can never be emptied of members
-- and stranded with Entries nobody can reach.
create policy "Members remove another member"
  on public.household_members
  for delete
  to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and user_id <> (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Redeeming an invite
-- ---------------------------------------------------------------------------

-- Is this token worth showing a form for? Returns the Household it belongs
-- to, or null.
--
-- SECURITY DEFINER because the person holding the invite is, by definition,
-- in no Household yet and so can see no invite row. It returns an opaque id
-- and nothing else -- no name, no Places -- so holding a bad token reveals
-- only that it is bad.
create function public.household_for_invite(p_token_hash text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select household_id
  from public.household_invites
  where token_hash = p_token_hash
    and accepted_at is null
    and expires_at > now();
$$;

revoke execute on function public.household_for_invite(text) from public;
grant execute on function public.household_for_invite(text) to anon, authenticated;

-- Claims the invite for the calling credential and joins it to the Household.
--
-- auth.uid() rather than a user id argument: the caller must already hold a
-- real session for the credential being joined, so this cannot be used to
-- push somebody else into a Household. Granted to authenticated only -- there
-- is no anonymous path through it at all.
--
-- The update is the lock. `accepted_at is null` in its WHERE means two
-- simultaneous redemptions of one token leave exactly one winner, and the
-- loser gets no row back and so no membership: that is what makes "single
-- use" true under a race rather than merely usually (story 5).
create function public.accept_household_invite(p_token_hash text)
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

  update public.household_invites
  set accepted_at = now()
  where token_hash = p_token_hash
    and accepted_at is null
    and expires_at > now()
  returning household_id into joined;

  if joined is null then
    return null;
  end if;

  insert into public.household_members (household_id, user_id)
  values (joined, claimer)
  on conflict do nothing;

  return joined;
end
$$;

revoke execute on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is in my Household?
-- ---------------------------------------------------------------------------

-- Emails live in auth.users, which no policy here can reach. Without them the
-- members screen could only offer to revoke one opaque uuid among several,
-- which is not a choice anyone can make safely.
--
-- Scoped to the caller's own Households by the same function every policy
-- uses, so it cannot be turned into a directory of everyone with an account.
create function public.household_members_for_current_user()
returns table (user_id uuid, email text, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.created_at
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id in (select public.household_ids_for_current_user())
  order by m.created_at;
$$;

revoke execute on function public.household_members_for_current_user() from public, anon;
grant execute on function public.household_members_for_current_user() to authenticated;
