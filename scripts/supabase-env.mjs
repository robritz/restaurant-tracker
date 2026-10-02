// What an operator script needs to reach a Supabase project, read once from
// the environment.
//
// Shared by the scripts rather than copied into each: this began as two
// verbatim copies of `src/lib/supabase/env.ts`, and `src/test/households.ts`
// records what that costs -- a copy that dropped the URL normalisation failed
// as an opaque PGRST125. The scripts cannot import the TypeScript original
// (they run under plain `node`, with no build step), so one copy for them all
// is as close as this gets.

export function readEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Copy .env.local.example to .env.local and fill it in.");
    process.exit(1);
  }
  return value;
}

// `supabase status` prints API_URL next to REST_URL, and pasting the wrong one
// fails obscurely.
export function normalizeUrl(url) {
  return url
    .replace(/\/(rest|auth|graphql|storage|functions)\/v1\/?$/, "")
    .replace(/\/$/, "");
}
