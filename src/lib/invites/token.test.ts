import { describe, expect, it } from "vitest";
import {
  INVITE_LIFETIME_MS,
  hashInviteToken,
  invitePath,
  inviteExpiry,
  newInviteToken,
} from "./token";

describe("newInviteToken", () => {
  it("is URL-safe, so it survives being pasted into a link", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newInviteToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, newInviteToken));
    expect(seen.size).toBe(500);
  });

  it("carries enough entropy that guessing one is not a way in", () => {
    // 32 bytes, base64url-encoded and unpadded.
    expect(newInviteToken()).toHaveLength(43);
  });
});

describe("hashInviteToken", () => {
  it("is stable for the same token", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it("differs for different tokens", () => {
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });

  it("does not contain the token, so the stored row is not a usable link", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).not.toContain(token);
  });

  it("is a sha-256 digest in hex", () => {
    expect(hashInviteToken("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("invitePath", () => {
  it("points at the join page for the token", () => {
    expect(invitePath("abc123")).toBe("/join/abc123");
  });

  it("escapes a token that would otherwise change the path", () => {
    expect(invitePath("a/b")).toBe("/join/a%2Fb");
  });
});

describe("inviteExpiry", () => {
  it("is the lifetime from now", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(inviteExpiry(now)).toEqual(
      new Date(now.getTime() + INVITE_LIFETIME_MS),
    );
  });

  it("expires within a week, so a forwarded link is not a standing door", () => {
    expect(INVITE_LIFETIME_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    expect(INVITE_LIFETIME_MS).toBeGreaterThan(0);
  });
});
