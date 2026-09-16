import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loadSupabaseEnv } from "./env";
import { serverOnlyCookie } from "./cookies";
import type { Database } from "./database.types";
import type { SupabaseDataClient } from "./client";

/**
 * The RLS-enforced client for server components and route handlers, reading
 * the caller's session from cookies. Requests made with it run as the
 * signed-in caller, so policies scope them without the route saying so.
 *
 * Distinct from `createSupabaseClient()` in ./client, which is anonymous: it
 * builds a client with no session attached and is therefore only useful where
 * there is nothing to scope.
 */
export async function createSupabaseServerClient(): Promise<SupabaseDataClient> {
  const { url, anonKey } = loadSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // Server components may not set cookies. That is not a failure here:
        // the middleware refreshes the session on every request, so a
        // refresh dropped in a server component has already happened
        // upstream. Route handlers *can* set them, and do.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, serverOnlyCookie(options));
          }
        } catch {
          // Ignored -- see above.
        }
      },
    },
  });
}
