/** The selected Place, in the URL so it survives refresh and is linkable. */
export const SELECTED_PARAM = "place";

export type Selection = { href: string; mode: "push" | "replace" };

/**
 * Where selecting a Place takes the app, and how it gets there.
 *
 * The first selection pushes, so the phone back gesture deselects the pin
 * instead of leaving the app. Moving pin to pin replaces, so that one back
 * always returns to the list rather than walking back through every pin the
 * user looked at.
 */
export function selectPlaceHref(id: string, hasSelection: boolean): Selection {
  return {
    href: `/map?${SELECTED_PARAM}=${encodeURIComponent(id)}`,
    mode: hasSelection ? "replace" : "push",
  };
}
