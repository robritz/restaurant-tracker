import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export const LOGIN_PATH = "/login";

/**
 * Reachable without a session. `/login` is obvious -- guarding it would leave
 * nowhere to sign in. `/api/auth/*` is the pair of routes that create and
 * destroy the session itself, so neither can require one.
 */
const PUBLIC_PATHS = [LOGIN_PATH, "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

// Client components fetch these, so they get a status code they can act on.
// A redirect would hand a fetch() the HTML of the login page where it
// expected JSON, and the failure would surface as a parse error.
function isApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * The single point where "everything is behind the login" is enforced, and
 * the only place the session is refreshed.
 *
 * Page requests without a session redirect to the login screen carrying
 * where they were headed; API requests get 401 in the `{ error }` shape the
 * routes already use.
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    // Nothing to do at the login screen once you are signed in. Landing there
    // with a live session and being asked to sign in again reads as a bug.
    if (user && pathname === LOGIN_PATH) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  if (user) return response;

  if (isApi(pathname)) {
    return NextResponse.json(
      { error: "You must be signed in to do that." },
      { status: 401 },
    );
  }

  const login = new URL(LOGIN_PATH, request.url);
  // Preserved whole, query string included, so a link to a specific pin
  // survives the detour through the login screen.
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own build output and the favicon. Image files
     * are excluded too: dish photos never travel through a Next route (they
     * are signed Supabase Storage URLs), so anything matching here is a
     * static asset, and running an auth round-trip per asset would be pure
     * latency.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
