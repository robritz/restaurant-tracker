# A Household has one admin

Every member used to be able to remove every other. That is fine for two people who trust each other and wrong as soon as a Household has three: an invited phone could remove the account that invited it, and the only thing stopping a Household losing the member who set it up was that nobody had tried.

The account `npm run seed` creates is now the Household's **admin**, recorded as `household_members.role`. The admin issues and revokes invites and removes any other member. Everyone else can remove only themselves.

A role on the membership, rather than a column on `households` or a separate table: the thing being described is a credential's relationship to a Household, which is exactly what a membership is. It also means the role disappears with the membership, so there is no second row to remember to clean up.

## The admin cannot leave

Two permissive delete policies, OR'd: *the admin removes anyone but themselves*, and *anyone who is not an admin removes themselves*. Nothing matches an admin removing their own row, so a Household always keeps the account that runs it and can never be emptied and stranded with Entries nobody can reach. Signing out is how that phone steps away.

The previous rule — nobody may remove themselves — bought the same guarantee more bluntly, and left a member who wanted out having to ask. This replaces it.

## `requireHousehold()` had to stop reading the table

It read `household_members` with `limit(1)` and no `user_id` filter, on the stated grounds that RLS "shows a caller only their own memberships". That was never true: the select policy is household-wide, so a caller sees every member of their Household. It was harmless while every Household had exactly one member. With a second phone and a role column it is not — `limit(1)` returns an arbitrary member's row, so a plain member could read back the admin's role and be treated as one.

The lookup now goes through `current_household_membership()`, a `SECURITY DEFINER` function keyed on `auth.uid()`, so "the caller's own membership" is something the database answers rather than something a filter has to remember to ask for. The policies were already independently correct; this was the app's view of them that was wrong.

## Consequences

Role is read in one place and compared against `"admin"`, never against `"member"`, so a role this code has not been taught about reads as no permission at all.

Routes check the role *and* the policies enforce it. The duplication is deliberate and one-directional: the policy is the gate, and the check exists only to turn a refusal into an answer that says which rule was met. A route that forgot its check would still be refused.

There is no way to promote a member, hand the Household over, or have two admins. None of those are needed by one family with a seeded account, and each is additive: a role column already distinguishes them.
