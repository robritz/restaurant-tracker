export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export interface ServiceRoleEnv extends SupabaseEnv {
  serviceRoleKey: string;
}

function readEnv(name: string): string {
  // .trim() guards against stray whitespace from a pasted value (e.g. a
  // trailing \r from a CRLF source).
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// `supabase status` prints API_URL right next to REST_URL (API_URL +
// "/rest/v1") -- easy to paste the wrong one. createClient() appends
// /rest/v1 itself, so a URL that already has it produces a doubled path and
// PostgREST fails with "Invalid path specified in request URL" (PGRST125),
// which gives no hint what's wrong. Strip it defensively.
export function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/(rest|auth|graphql|storage|functions)\/v1\/?$/, "").replace(/\/$/, "");
}

/**
 * Connection config for the anon (RLS-enforced) client. `SUPABASE_URL` has
 * no `NEXT_PUBLIC_` prefix, so it is server-only -- Next.js inlines just the
 * prefixed vars into client bundles. Pass an explicit `SupabaseEnv` to
 * `createSupabaseClient()` if this client is ever needed in the browser.
 */
export function loadSupabaseEnv(): SupabaseEnv {
  return {
    url: normalizeSupabaseUrl(readEnv("SUPABASE_URL")),
    anonKey: readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

/**
 * Connection config for the service-role client. This key bypasses RLS, so
 * it must only be read on the server (API routes, server components) --
 * never shipped to the browser.
 */
export function loadServiceRoleEnv(): ServiceRoleEnv {
  return {
    ...loadSupabaseEnv(),
    serviceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
