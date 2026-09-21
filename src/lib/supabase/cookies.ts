import type { CookieOptions } from "@supabase/ssr";

/**
 * @supabase/ssr leaves session cookies readable by scripts, because it
 * assumes a Supabase client running in the browser needs to read them. This
 * app signs in through a route handler and never builds a browser client, so
 * nothing on the page has any business reading the session -- and marking it
 * HttpOnly means a cross-site scripting bug cannot walk off with it.
 *
 * If a browser-side Supabase client is ever introduced, this is what will
 * have to give.
 */
export function serverOnlyCookie(options: CookieOptions): CookieOptions {
  return { ...options, httpOnly: true };
}
