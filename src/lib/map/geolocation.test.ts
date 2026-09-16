import { describe, expect, it } from "vitest";
import { geolocateFailure } from "./geolocation";

// The codes the Geolocation API defines. Named here rather than imported,
// since a node-only test has no GeolocationPositionError to read them off.
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

describe("geolocateFailure", () => {
  it("says the permission was declined, rather than that the lookup failed", () => {
    // The whole point of the criterion: a refused permission is a choice the
    // user made and can undo, not a lookup that went wrong.
    const { message } = geolocateFailure(PERMISSION_DENIED);

    expect(message).toMatch(/location access/i);
    expect(message).toMatch(/settings/i);
  });

  it("keeps the declined message up, because the control stays dead after it", () => {
    // mapbox-gl disables the button for the rest of the session once
    // permission is refused, so a message that fades leaves a broken-looking
    // control with nothing explaining it.
    expect(geolocateFailure(PERMISSION_DENIED).persistent).toBe(true);
  });

  it("lets the recoverable failures fade, since trying again is the fix", () => {
    expect(geolocateFailure(POSITION_UNAVAILABLE).persistent).toBe(false);
    expect(geolocateFailure(TIMEOUT).persistent).toBe(false);
  });

  it("distinguishes a position it couldn't get from one it waited too long for", () => {
    expect(geolocateFailure(POSITION_UNAVAILABLE).message).not.toBe(
      geolocateFailure(TIMEOUT).message,
    );
  });

  it("still says something for a code it doesn't know", () => {
    // Failing silently is the exact thing this ticket exists to stop, so an
    // unrecognised code must not fall through to no message at all.
    const { message, persistent } = geolocateFailure(99);

    expect(message).toBeTruthy();
    expect(persistent).toBe(false);
  });
});
