import { describe, expect, it } from "vitest";
import { SELECTED_PARAM, selectPlaceHref } from "./selection";

const NOTHING_SELECTED = { hasSelection: false, hasPushedSelection: false };

describe("selectPlaceHref", () => {
  it("pushes the first selection, so the back gesture deselects rather than leaving the map", () => {
    expect(selectPlaceHref("place-1", NOTHING_SELECTED)).toEqual({
      href: `/map?${SELECTED_PARAM}=place-1`,
      mode: "push",
    });
  });

  it("replaces when moving pin to pin, so one back returns to the list", () => {
    expect(
      selectPlaceHref("place-2", {
        hasSelection: true,
        hasPushedSelection: true,
      }),
    ).toEqual({ href: `/map?${SELECTED_PARAM}=place-2`, mode: "replace" });
  });

  it("pushes over a selection that arrived in the link, so back stays on the map", () => {
    expect(
      selectPlaceHref("place-2", {
        hasSelection: true,
        hasPushedSelection: false,
      }).mode,
    ).toBe("push");
  });

  it("pushes again after a back deselected, so the next back deselects too", () => {
    expect(
      selectPlaceHref("place-3", {
        hasSelection: false,
        hasPushedSelection: true,
      }).mode,
    ).toBe("push");
  });

  it("encodes the id, since it reaches the URL verbatim", () => {
    expect(selectPlaceHref("a b/c", NOTHING_SELECTED).href).toBe(
      `/map?${SELECTED_PARAM}=a%20b%2Fc`,
    );
  });
});
