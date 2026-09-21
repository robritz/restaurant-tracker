import { describe, expect, it } from "vitest";
import { DEFAULT_DESTINATION, safeDestination } from "./redirect";

describe("safeDestination", () => {
  it("keeps a path on this site", () => {
    expect(safeDestination("/map")).toBe("/map");
  });

  it("keeps the query string, so a link to a pin survives the login", () => {
    expect(safeDestination("/map?place=place-uuid-1")).toBe(
      "/map?place=place-uuid-1",
    );
  });

  it("falls back when there is no destination", () => {
    expect(safeDestination(undefined)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination(null)).toBe(DEFAULT_DESTINATION);
    expect(safeDestination("")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses an absolute URL, which would be an open redirect", () => {
    expect(safeDestination("https://evil.test/phish")).toBe(DEFAULT_DESTINATION);
  });

  it("refuses a protocol-relative URL, which browsers treat as absolute", () => {
    expect(safeDestination("//evil.test/phish")).toBe(DEFAULT_DESTINATION);
    expect(safeDestination("/\\evil.test/phish")).toBe(DEFAULT_DESTINATION);
  });
});
