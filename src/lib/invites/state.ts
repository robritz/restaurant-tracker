/** What an invite row is now: still usable, already spent, or timed out. */
export type InviteState = "live" | "accepted" | "expired";

/**
 * Display only. The database decides whether an invite can actually be
 * redeemed (`accept_household_invite`); this just says what to label the row,
 * and uses the same boundary -- expired *at* expires_at -- so the two cannot
 * disagree about a row the screen calls live.
 */
export function inviteState(
  invite: { expires_at: string; accepted_at: string | null },
  now: Date = new Date(),
): InviteState {
  if (invite.accepted_at) return "accepted";
  return Date.parse(invite.expires_at) <= now.getTime() ? "expired" : "live";
}
