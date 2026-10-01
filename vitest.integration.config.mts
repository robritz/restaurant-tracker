import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration tests, which need the local Supabase stack running
 * (`npm run supabase:start`). Kept in a separate project from the unit tests
 * so `npm test` stays hermetic and fast, and a machine with no Docker can
 * still run it.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Vitest's default, stated out loud because CI depends on it: a run that
    // matches no test files, or matches a file defining none, must fail. "0
    // tests passed" is otherwise indistinguishable from "0 tests failed", and
    // a glob that quietly stops matching is exactly how a suite gets skipped
    // for a month without anyone noticing.
    passWithNoTests: false,
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["src/test/setup-env.ts"],
    // Real network round-trips, a seeded fixture per file, and storage
    // uploads. The unit-test default is far too tight.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The fixtures insert shared Places and sign in real users; running
    // files in parallel against one database invites cross-talk.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
