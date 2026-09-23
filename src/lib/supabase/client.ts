import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadServiceRoleEnv, loadSupabaseEnv, normalizeSupabaseUrl, type SupabaseEnv } from "./env";
import type { Database } from "./database.types";

export type SupabaseDataClient = SupabaseClient<Database>;

/**
 * The anonymous RLS-enforced client: no session is attached, so every table
 * is empty to it now that policies are in place. Useful only where there is
 * nothing to scope. Routes that need the signed-in caller want
 * `createSupabaseServerClient()` in ./server instead.
 *
 * Omitting `env` reads `SUPABASE_URL`/`SUPABASE_ANON_KEY` from
 * `process.env`, which works server-side only -- neither is inlined into
 * client bundles. Browser callers must pass `env` explicitly.
 */
export function createSupabaseClient(env?: SupabaseEnv): SupabaseDataClient {
  const { url, anonKey } = env
    ? { url: normalizeSupabaseUrl(env.url), anonKey: env.anonKey }
    : loadSupabaseEnv();
  return createClient<Database>(url, anonKey);
}

/**
 * Bypasses RLS entirely. Server-only (API routes, server components) --
 * never expose the service role key to the browser.
 *
 * Reach for this to upload to, or sign a URL from, the photo bucket, and for
 * nothing else: tables are protected by their policies, and a table read made
 * with this client has opted out of every one of them
 * (docs/adr/0005-service-role-for-storage-only.md).
 */
export function createSupabaseServiceRoleClient(): SupabaseDataClient {
  const { url, serviceRoleKey } = loadServiceRoleEnv();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
