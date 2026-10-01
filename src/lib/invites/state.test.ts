import { describe, expect, it } from "vitest";
import { inviteState } from "./state";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const live = { expires_at: "2026-10-05T12:00:00.000Z", accepted_at: null };

describe("inviteState", () => {
  it("is live while it is unused and unexpired", () => {
    expect(inviteState(live, NOW)).toBe("live");
  });

  it("is used once it has been accepted", () => {
    expect(
      inviteState({ ...live, accepted_at: "2026-10-02T09:00:00.000Z" }, NOW),
    ).toBe("accepted");
  });

  it("reads as used, not expired, when it was accepted before expiring", () => {
    // Which happened first is the useful fact: an accepted invite brought
    // someone in, an expired one never did.
    expect(
      inviteState(
        { expires_at: "2026-09-01T00:00:00.000Z", accepted_at: "2026-08-30T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("accepted");
  });

  it("is expired once its moment has passed", () => {
    expect(inviteState({ ...live, expires_at: "2026-09-30T12:00:00.000Z" }, NOW)).toBe(
      "expired",
    );
  });

  it("is expired exactly at its expiry, matching the database's `expires_at > now()`", () => {
    expect(inviteState({ ...live, expires_at: NOW.toISOString() }, NOW)).toBe("expired");
  });
});
