// Next 16 removed `next lint`, so ESLint is configured and invoked directly.
// `eslint-config-next` ships flat config, which is all this needs -- no
// eslintrc compatibility shim.
import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    // Build output, dependencies, and Supabase's local scratch space. Nothing
    // here is ours to fix.
    ignores: [
      ".next/**",
      "node_modules/**",
      "supabase/.temp/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
