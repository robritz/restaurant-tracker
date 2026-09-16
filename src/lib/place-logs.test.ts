import { describe, expect, it } from "vitest";
import { MAX_PLACE_LOG_ENTRIES, skeletonCount } from "./place-logs";

describe("skeletonCount", () => {
  it("draws one placeholder per dish, so the panel shows how much is coming", () => {
    expect(skeletonCount(3)).toBe(3);
  });

  it("never promises more dishes than the endpoint will return", () => {
    expect(skeletonCount(MAX_PLACE_LOG_ENTRIES + 10)).toBe(
      MAX_PLACE_LOG_ENTRIES,
    );
  });
});
