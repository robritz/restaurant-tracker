# Entries are owned by a Household, not a User

Auth arrives as one login for one family, but Entries are scoped to a **Household** — a `households` row, a `household_members` row per credential, and `entries.household_id` — rather than directly to the `auth.users` row that signed in. The obvious alternative, `entries.user_id references auth.users`, was rejected: this is a family app, and the first thing a family wants is a second phone on the same map. Under user-owned Entries that means sharing one password, with no way to revoke a single device; under a Household it means inserting a membership row.

## Consequences

`CONTEXT.md` deliberately lists *Account* and *User* under `_Avoid_`: "Account" blurs the credential with the owner, and "User" implies one person when a Household is several. A future reader seeing one login and one family will be tempted to collapse the join table away — the join table is the point.

There is still no concept of an individual person *inside* a Household, so an Entry does not record which family member ate the dish. That is additive when it arrives; merging separately-owned datasets into a Household afterwards would not have been.

Reversing this after real data exists means rewriting every ownership predicate and migrating rows, which is why it is being paid for now, while the database is empty.
