export const DEFAULT_DESTINATION = "/";

/**
 * Where to send someone after they sign in.
 *
 * The `next` parameter arrives from the URL, so it is attacker-controlled: an
 * absolute URL, or a protocol-relative `//evil.test`, would turn the login
 * screen into an open redirect that borrows this app's credibility. Only a
 * path on this site is honoured; anything else falls back to the capture tab.
 */
export function safeDestination(next: string | undefined | null): string {
  if (!next) return DEFAULT_DESTINATION;
  if (!next.startsWith("/")) return DEFAULT_DESTINATION;
  // "//host" and "/\host" are both read as protocol-relative by browsers.
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_DESTINATION;
  return next;
}
