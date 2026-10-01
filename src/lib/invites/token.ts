import { createHash, randomBytes } from "node:crypto";

/**
 * Seven days. Long enough to be sent and acted on, short enough that a link
 * left in a chat history stops working (story 5).
 */
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 bytes, so guessing one is not a way into a Household. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Only the hash is stored. A database read -- a backup, a leaked dump, a
 * member reading their own invite rows -- therefore yields nothing that can
 * be redeemed; the token itself exists only in the link.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitePath(token: string): string {
  return `/join/${encodeURIComponent(token)}`;
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_LIFETIME_MS);
}
