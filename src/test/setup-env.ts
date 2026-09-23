import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Integration tests talk to the local Supabase stack, whose URL and keys live
 * in .env.local alongside every other secret. Vitest does not read it, and
 * the routes under test load their configuration straight from process.env,
 * so it is loaded here rather than threaded through the tests.
 *
 * Values already in the environment win, so CI can supply its own without
 * editing a file.
 */
const ENV_FILE = path.resolve(import.meta.dirname, "../../.env.local");

try {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    // Keys are matched case-insensitively: a lowercase entry silently
    // skipped would look exactly like a missing one.
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    // Strip one layer of matching quotes, the way a shell would.
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {
  // An absent .env.local is not itself fatal -- CI may supply the same
  // values directly. The check below is what turns either case into one
  // clear message.
}

const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = REQUIRED.filter((name) => !process.env[name]?.trim());

if (missing.length) {
  throw new Error(
    [
      `Integration tests need ${missing.join(", ")}.`,
      "",
      "These come from .env.local, which is not committed. If the local",
      "Supabase stack is not running, start it and copy its keys:",
      "",
      "  npm run supabase:start",
      "  npm run supabase:status",
      "",
      "The unit suite needs none of this -- run `npm test` instead.",
    ].join("\n"),
  );
}
