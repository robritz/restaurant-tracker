/** The selected Place, in the URL so it survives refresh and is linkable. */
export const SELECTED_PARAM = "place";

export type History = {
  /** Whether a Place is selected right now. */
  hasSelection: boolean;
  /** Whether this session has pushed a selection of its own. */
  hasPushedSelection: boolean;
};

export type Selection = { href: string; mode: "push" | "replace" };

/**
 * Where selecting a Place takes the app, and how it gets there.
 *
 * The first selection pushes, so the phone back gesture deselects the pin
 * instead of leaving the app. Moving pin to pin then replaces, so that one
 * back always returns to the list rather than walking back through every
 * pin the user looked at.
 *
 * Which makes "the first" two cases, not one: a selection that arrived in
 * a shared link was never pushed by this session, so the tap after it has
 * to push or back would leave the map -- and a back that deselected leaves
 * the session having pushed, with nothing selected, needing a push again.
 */
export function selectPlaceHref(id: string, history: History): Selection {
  const pushed = history.hasSelection && history.hasPushedSelection;
  return {
    href: `/map?${SELECTED_PARAM}=${encodeURIComponent(id)}`,
    mode: pushed ? "replace" : "push",
  };
}
