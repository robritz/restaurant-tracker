# A second phone joins by invitation, not by signing up

A Household is the family, but only the seeded credential could reach it. Joining is by **invitation from an existing member**: a member issues a single-use, expiring token, and whoever opens the link chooses their own email and password. Self-signup stays off (issue #34) — an open registration form on a deployed URL is the thing the login gate exists to prevent, and leaving it off means the only way in is a link somebody already inside chose to send.

Only the token's SHA-256 hash is stored. The token exists in the link and nowhere else, so a database read — a backup, a dump, a member reading their own invite rows — yields nothing redeemable. Losing the link means issuing another.

## The service role

`docs/adr/0005-service-role-for-storage-only.md` says the service-role key is retained for storage and nothing else, and names the risk: a table read made with it has opted out of every policy. Creating a credential needs `auth.admin`, which no RLS-enforced client can do, so `POST /api/invites/accept` is the second exception.

It is kept to exactly that. The route uses the service role for `auth.admin.createUser` and, on a lost race, `deleteUser` — never for a table. Reading the invite, claiming it, and inserting the membership all go through `SECURITY DEFINER` functions that scope themselves: `household_for_invite` returns an opaque id or null, and `accept_household_invite` joins `auth.uid()` rather than a user id it is handed, so it is granted to `authenticated` only and has no anonymous path through it. ADR-0005's line — tables are protected by the database — therefore still holds.

## Consequences

The claim is an `UPDATE ... WHERE accepted_at is null` returning the Household, so two simultaneous redemptions of one token leave exactly one winner. Single-use is a property of that WHERE clause, not of a check-then-act in TypeScript.

Revoking an invite is deleting the row; revoking a membership is deleting the `household_members` row. Every policy reads membership live, so access ends on the next query with no cached grant to expire. A removed member's sign-in survives, attached to nothing — it can authenticate and sees the "not attached to a household" state. Deleting the identity too would mean reaching for the service role again, for a reason that is not storage, to end access that has already ended.

Nobody can remove themselves. Signing out is how you leave, and the rule means a Household can never be emptied of members and stranded with Entries nobody can reach.

Entries still record no member (`CONTEXT.md`, ADR-0004). A second member is a row in a join table, not a column on an Entry, which is what lets this be additive.
