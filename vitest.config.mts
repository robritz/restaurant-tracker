import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // See vitest.integration.config.mts for why this is stated rather than
    // left to the default; it matters most there, and symmetry here keeps the
    // two suites answerable to the same rule.
    passWithNoTests: false,
    // Operator scripts live outside src/ and are plain .mjs so `node` can run
    // them without a build step; their tests belong to this suite all the same.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // Integration tests need the local Supabase stack, so they are a
    // separate project (vitest.integration.config.mts). `npm test` stays
    // hermetic.
    // Spread the defaults back in: assigning `exclude` replaces them, which
    // would quietly put node_modules and dist back in scope.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
