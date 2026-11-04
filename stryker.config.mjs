// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  // The unit suite only. Integration tests need the local Supabase stack and
  // would make every mutant pay for a database round trip.
  vitest: { configFile: "vitest.config.mts" },
  // What the unit suite can actually reach. Components (.tsx) have no tests
  // in this node-environment suite, so mutating them would only report noise;
  // generated types have no behavior to mutate.
  mutate: [
    "src/**/*.ts",
    "scripts/**/*.mjs",
    "!src/**/*.test.ts",
    "!scripts/**/*.test.mjs",
    "!src/test/**",
    "!src/lib/supabase/database.types.ts",
  ],
  // Mutants that break the types would fail `npm run typecheck` anyway;
  // killing them up front keeps the score about tests, not the compiler.
  checkers: ["typescript"],
  // The app tsconfig only reaches scripts/*.mjs through imports, and the
  // checker refuses to mutate a file it was not asked to watch.
  tsconfigFile: "tsconfig.stryker.json",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
};
