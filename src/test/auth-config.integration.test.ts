import { afterAll, describe, expect, it } from "vitest";
import { createSupabaseClient } from "@/lib/supabase/client";
import { serviceRoleClient } from "./households";

/**
 * The two halves of #34's front door, asserted against a running stack.
 *
 * Both are properties of supabase/config.toml rather than of any TypeScript,
 * which is exactly why they need a test. A config change takes effect only on
 * `supabase stop && start`, so a long-running local stack keeps serving the
 * old settings and a mistake here stays invisible until someone starts fresh
 * -- which, before CI existed, meant nobody.
 *
 * This is not hypothetical. `[auth.email] enable_signup = false` reads as
 * "nobody may register", but the Supabase CLI maps it to
 * GOTRUE_EXTERNAL_EMAIL_ENABLED, which disables email as a way of signing in
 * at all. Main carried that for a fortnight: a fresh checkout could seed a
 * Household and then not log into it. Self-signup is turned off by the
 * *global* `[auth] enable_signup = false` instead, and these two tests are
 * what keep the distinction honest.
 */
describe("auth configuration (real stack)", () => {
  const created: string[] = [];

  afterAll(async () => {
    // Only reachable if the signup test failed, but a regression must not
    // also leave an account behind.
    if (!created.length) return;
    const admin = serviceRoleClient();
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  it("lets a seeded member sign in with an email and a password", async () => {
    // Stories 1 and 2. The credential is created here rather than borrowed
    // from .env.local so the test says nothing about the operator's own
    // password and works on a database seeded any way at all.
    const admin = serviceRoleClient();
    const email = `signin-check-${Date.now()}@households.test`;
    const password = `pw-${Date.now()}`;

    const { data: user, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError).toBeNull();
    created.push(user!.user!.id);

    const { data, error } = await createSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });

    // The failure this guards against is "Email logins are disabled".
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();

    const admin2 = serviceRoleClient();
    await admin2.auth.admin.deleteUser(user!.user!.id);
    created.length = 0;
  });

  it("refuses to let a stranger sign themselves up", async () => {
    // Story 26: deploying the app must not open it to anyone who finds the
    // URL. The gate is worth nothing if the login screen will mint accounts.
    const { data, error } = await createSupabaseClient().auth.signUp({
      email: `intruder-${Date.now()}@households.test`,
      password: "hunter2hunter2",
    });

    if (data.user) created.push(data.user.id);

    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});
