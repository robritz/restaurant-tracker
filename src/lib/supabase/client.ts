import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadServiceRoleEnv, loadSupabaseEnv, normalizeSupabaseUrl, type SupabaseEnv } from "./env";
import type { Database } from "./database.types";

export type SupabaseDataClient = SupabaseClient<Database>;

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
