import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadServiceRoleEnv, loadSupabaseEnv, normalizeSupabaseUrl, type SupabaseEnv } from "./env";

// No tables exist yet -- once a migration adds some, run `npm run gen:types`
// and swap this for `SupabaseClient<Database>` (see the food-tracker repo's
// data-access/src/client.ts for the pattern).
export type SupabaseDataClient = SupabaseClient;

/**
 * The client for use in client components and browser code. Requests are
 * made as the signed-in caller (or anonymous, until auth exists), so once
 * RLS policies are added they'll scope reads/writes automatically.
 *
 * `env` is optional -- callers that already have `NEXT_PUBLIC_SUPABASE_URL`/
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `process.env` (true in both the browser
 * and server, since Next.js inlines `NEXT_PUBLIC_*` vars at build time) can
 * omit it.
 */
export function createSupabaseClient(env?: SupabaseEnv): SupabaseDataClient {
  const { url, anonKey } = env
    ? { url: normalizeSupabaseUrl(env.url), anonKey: env.anonKey }
    : loadSupabaseEnv();
  return createClient(url, anonKey);
}

/**
 * Bypasses RLS entirely. Server-only (API routes, server components) --
 * never expose the service role key to the browser.
 */
export function createSupabaseServiceRoleClient(): SupabaseDataClient {
  const { url, serviceRoleKey } = loadServiceRoleEnv();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
