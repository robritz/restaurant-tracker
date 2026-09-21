import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { loadSupabaseEnv } from "./env";
import { serverOnlyCookie } from "./cookies";
import type { Database } from "./database.types";

export type SessionResult = {
  /**
   * Carries any cookies a token refresh produced. The caller must return
   * *this* response (or copy its cookies onto another), or the refreshed
   * session is thrown away and the caller is signed out an hour later.
   */
  response: NextResponse;
  user: { id: string } | null;
};

/**
 * Reads the caller's session, refreshing the access token if it has expired.
 *
 * This is the only place a refresh happens. Doing it in middleware rather
 * than per-route is what stops "signed out mid-upload" from being an
 * intermittent bug in whichever route forgot.
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  const { url, anonKey } = loadSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Rebuilt from the mutated request so the refreshed cookies are
        // visible both to whatever handles this request downstream and to
        // the browser.
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, serverOnlyCookie(options));
        }
      },
    },
  });

  // getUser(), not getSession(): getSession() trusts whatever the cookie
  // says, while getUser() revalidates the token with the auth server. A
  // forged cookie must not be a way in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
