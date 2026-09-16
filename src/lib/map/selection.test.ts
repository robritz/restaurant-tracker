import { describe, expect, it } from "vitest";
import { SELECTED_PARAM, selectPlaceHref } from "./selection";

describe("selectPlaceHref", () => {
  it("pushes the first selection, so the back gesture deselects rather than leaving the map", () => {
    expect(selectPlaceHref("place-1", false)).toEqual({
      href: `/map?${SELECTED_PARAM}=place-1`,
      mode: "push",
    });
  });

  it("replaces when moving pin to pin, so one back returns to the list", () => {
    expect(selectPlaceHref("place-2", true)).toEqual({
      href: `/map?${SELECTED_PARAM}=place-2`,
      mode: "replace",
    });
  });

  it("encodes the id, since it reaches the URL verbatim", () => {
    expect(selectPlaceHref("a b/c", false).href).toBe(
      `/map?${SELECTED_PARAM}=a%20b%2Fc`,
    );
  });
});
