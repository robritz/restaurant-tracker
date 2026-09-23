import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
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
