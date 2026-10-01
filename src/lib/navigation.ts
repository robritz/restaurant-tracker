/**
 * Cross a session boundary with a full document load, not a router push.
 *
 * The map is deliberately kept alive across tab navigation, holding a live
 * Mapbox instance and the PlaceLogs it has already fetched. A client-side
 * navigation leaves all of that mounted, so the previous session's pins would
 * still be on screen behind the login. A document load destroys it by
 * construction -- and keeps doing so for whatever state gets cached next,
 * without anyone having to remember to reset it.
 *
 * Signing in, signing out, joining a Household and leaving one all go through
 * here, so the reasoning lives in one place rather than in four comments.
 *
 * Adding a fifth: `@next/next/no-location-assign-relative-destination` flags
 * `window.location.assign("/somewhere")` and cannot see through this
 * function's parameter. That is the point of routing them here rather than a
 * way around the rule -- a direct call elsewhere is still flagged, and should
 * be, because the accidental use is exactly what the rule is for.
 */
export function hardNavigate(destination: string): void {
  window.location.assign(destination);
}
