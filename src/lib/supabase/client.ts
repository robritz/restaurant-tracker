import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadServiceRoleEnv, loadSupabaseEnv, normalizeSupabaseUrl, type SupabaseEnv } from "./env";
import type { Database } from "./database.types";

export type SupabaseDataClient = SupabaseClient<Database>;

/**
 * The RLS-enforced client. Requests are made as the signed-in caller (or
 * anonymous, until auth exists), so once RLS policies are added they'll
 * scope reads/writes automatically.
 *
 * Omitting `env` reads `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` from
 * `process.env`, which works server-side only -- `SUPABASE_URL` is not
 * inlined into client bundles. Browser callers must pass `env` explicitly.
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
 */
export function createSupabaseServiceRoleClient(): SupabaseDataClient {
  const { url, serviceRoleKey } = loadServiceRoleEnv();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
