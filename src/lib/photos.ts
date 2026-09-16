/**
 * Where Entry photos live and how long a URL into them lasts. Shared by
 * every route that touches the bucket, so a rename or a TTL change happens
 * in one place rather than three.
 */
export const PHOTO_BUCKET = "entry-photos";

// An hour is far longer than a panel session, and nothing detects or
// refreshes an expired URL: a PlaceLog is re-fetched every time its pin is
// selected, which is what keeps its URLs fresh.
export const SIGNED_URL_TTL_SECONDS = 3600;
