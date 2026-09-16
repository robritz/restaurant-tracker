/**
 * Why locating the user failed, and how long to say so for.
 *
 * Kept together because they are one decision -- "make a refused permission
 * legible" -- and the two answers move together: declining is the only
 * failure the user can't fix by tapping the control again, because mapbox-gl
 * disables it for the rest of the session once permission is refused. A
 * message that fades would leave exactly the dead-looking button this is
 * here to explain.
 */
export type GeolocateFailure = {
  message: string;
  /** Whether the message stays up rather than auto-hiding. */
  persistent: boolean;
};

// GeolocationPositionError's codes, named here because this runs in node
// tests as well as the browser.
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

export function geolocateFailure(code: number): GeolocateFailure {
  switch (code) {
    case PERMISSION_DENIED:
      return {
        message:
          "Location access is off for this site. Turn it on in your browser settings to see where you are on the map.",
        persistent: true,
      };
    case POSITION_UNAVAILABLE:
      return {
        message: "Couldn’t work out where you are. Your places are unaffected.",
        persistent: false,
      };
    case TIMEOUT:
      return {
        message: "Finding your location took too long. Try again.",
        persistent: false,
      };
    // Anything else still gets a message: failing silently is the thing this
    // is here to stop, and an unrecognised code is no less of a failure.
    default:
      return {
        message: "Couldn’t find your location.",
        persistent: false,
      };
  }
}
