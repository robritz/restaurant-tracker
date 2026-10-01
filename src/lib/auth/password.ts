/**
 * The app's floor for a password someone chooses for themselves. Supabase's
 * own is 6; this is stricter, and lives here so the route that enforces it
 * and the form that previews it cannot drift apart.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const PASSWORD_TOO_SHORT = `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
