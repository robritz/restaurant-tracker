# The service role is retained for storage only

With RLS policies in place, table reads and writes run as the signed-in caller through a request-scoped client. The photo bucket does not: uploads and signed URLs keep using the service-role key. The natural reading of "we added auth" is that the service role is gone entirely, so this exception is recorded rather than left to be discovered.

The alternative — storage RLS policies authorising objects by parsing ownership out of the object path — was rejected as fiddly for what it buys. Keeping the key server-side draws a simpler line: **tables are protected by the database, the bucket is protected by never handing out its key.** Authorisation still happens in Postgres, because the route that mints a signed URL does an RLS-enforced read of the Entry first and signs nothing if that read comes back empty.

## Consequences

Photo paths are keyed `{household_id}/{place_id}/{uuid}` so ownership is visible in the path itself. Nothing enforces that today — it is groundwork, so that adding storage policies later, or deleting a Household's photos, is a prefix operation rather than a migration.

The remaining exposure is that the service-role key bypasses RLS on every table, not just storage. Any route that reaches for `createSupabaseServiceRoleClient()` for a table read has silently opted out of every policy here, which is the thing to watch for in review.
