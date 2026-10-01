import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCredential,
  seedTwoHouseholds,
  serviceRoleClient,
  type Credential,
  type Fixture,
} from "./households";
import { hashInviteToken, newInviteToken } from "@/lib/invites/token";

/**
 * Invites and membership, against the real database.
 *
 * Every guarantee this feature makes -- single use, expiry, "this Household
 * and no other", revocation taking effect at once -- is enforced in Postgres,
 * by a policy or by the WHERE clause of a claim. None of it can be observed
 * against a mocked client, which would keep passing with the whole migration
 * reverted.
 */
describe("Household invites (real database)", () => {
  let fixture: Fixture;

  /** Issues an invite into a Household as the service role, returning the token. */
  async function issue(
    householdId: string,
    options: { expiresAt?: Date } = {},
  ): Promise<{ token: string; id: string }> {
    const admin = serviceRoleClient();
    const token = newInviteToken();
    const { data, error } = await admin
      .from("household_invites")
      .insert({
        household_id: householdId,
        token_hash: hashInviteToken(token),
        expires_at: (
          options.expiresAt ?? new Date(Date.now() + 60_000)
        ).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`issue invite: ${error?.message}`);
    return { token, id: data.id };
  }

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  describe("issuing", () => {
    it("lets a member issue an invite into their own Household", async () => {
      const { data, error } = await fixture.a.client
        .from("household_invites")
        .insert({
          household_id: fixture.a.id,
          token_hash: hashInviteToken(newInviteToken()),
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });

    it("refuses an invite issued into somebody else's Household", async () => {
      // Story 6, at the point it actually matters: not that the route
      // declines to send the wrong household_id, but that the database
      // declines to accept one.
      const { error } = await fixture.a.client.from("household_invites").insert({
        household_id: fixture.b.id,
        token_hash: hashInviteToken(newInviteToken()),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/row-level security/i);
    });

    it("shows a member their own Household's invites and no others", async () => {
      await issue(fixture.b.id);
      const { data } = await fixture.a.client
        .from("household_invites")
        .select("household_id");

      expect(data?.every((row) => row.household_id === fixture.a.id)).toBe(true);
    });
  });

  describe("looking an invite up", () => {
    it("resolves a live token to the Household that issued it", async () => {
      const { token } = await issue(fixture.a.id);

      const { data } = await fixture.a.client.rpc("household_for_invite", {
        p_token_hash: hashInviteToken(token),
      });

      expect(data).toBe(fixture.a.id);
    });

    it("resolves a token nobody issued to nothing", async () => {
      const { data } = await fixture.a.client.rpc("household_for_invite", {
        p_token_hash: hashInviteToken(newInviteToken()),
      });

      expect(data).toBeNull();
    });

    it("answers someone holding no session, since a joiner has none", async () => {
      // The counterpart to the grant checked below: the lookup *is* open to
      // anon, so the join page can tell a dead link from a live one before
      // anybody has an account. It reveals an opaque id and nothing else.
      const { createSupabaseClient } = await import("@/lib/supabase/client");
      const { token } = await issue(fixture.a.id);

      const { data, error } = await createSupabaseClient().rpc(
        "household_for_invite",
        { p_token_hash: hashInviteToken(token) },
      );

      expect(error).toBeNull();
      expect(data).toBe(fixture.a.id);
    });

    it("resolves an expired token to nothing", async () => {
      const { token } = await issue(fixture.a.id, {
        expiresAt: new Date(Date.now() - 1_000),
      });

      const { data } = await fixture.a.client.rpc("household_for_invite", {
        p_token_hash: hashInviteToken(token),
      });

      expect(data).toBeNull();
    });
  });

  describe("redeeming", () => {
    let joiner: Credential;

    beforeAll(async () => {
      joiner = await createCredential("joiner");
    });

    afterAll(async () => {
      await joiner?.remove();
    });

    it("joins the claiming credential to the issuing Household", async () => {
      const { token } = await issue(fixture.a.id);

      const { data } = await joiner.client.rpc("accept_household_invite", {
        p_token_hash: hashInviteToken(token),
      });

      expect(data).toBe(fixture.a.id);
      const { data: mine } = await joiner.client.rpc("household_ids_for_current_user");
      expect(mine).toContain(fixture.a.id);
    });

    it("cannot be redeemed twice", async () => {
      // Story 5. The first claim stamps accepted_at, which is in the WHERE
      // clause of the second.
      const { token } = await issue(fixture.a.id);
      const hash = hashInviteToken(token);

      const first = await joiner.client.rpc("accept_household_invite", {
        p_token_hash: hash,
      });
      const second = await joiner.client.rpc("accept_household_invite", {
        p_token_hash: hash,
      });

      expect(first.data).toBe(fixture.a.id);
      expect(second.data).toBeNull();
    });

    it("has exactly one winner when two redeem the same token at once", async () => {
      const second = await createCredential("racer");
      try {
        const { token } = await issue(fixture.b.id);
        const hash = hashInviteToken(token);

        const results = await Promise.all([
          joiner.client.rpc("accept_household_invite", { p_token_hash: hash }),
          second.client.rpc("accept_household_invite", { p_token_hash: hash }),
        ]);

        expect(results.filter((r) => r.data === fixture.b.id)).toHaveLength(1);
        expect(results.filter((r) => r.data === null)).toHaveLength(1);
      } finally {
        await second.remove();
      }
    });

    it("refuses an expired token", async () => {
      const { token } = await issue(fixture.a.id, {
        expiresAt: new Date(Date.now() - 1_000),
      });

      const { data } = await joiner.client.rpc("accept_household_invite", {
        p_token_hash: hashInviteToken(token),
      });

      expect(data).toBeNull();
    });

    it("refuses a revoked token", async () => {
      const { token, id } = await issue(fixture.a.id);
      const { error } = await fixture.a.client
        .from("household_invites")
        .delete()
        .eq("id", id);
      expect(error).toBeNull();

      const { data } = await joiner.client.rpc("accept_household_invite", {
        p_token_hash: hashInviteToken(token),
      });

      expect(data).toBeNull();
    });

    it("joins only the Household that issued it", async () => {
      // Story 6. A token issued by B puts the claimer in B -- never in A,
      // whose invites the same claimer may also be holding.
      const outsider = await createCredential("outsider");
      try {
        const { token } = await issue(fixture.b.id);

        const { data } = await outsider.client.rpc("accept_household_invite", {
          p_token_hash: hashInviteToken(token),
        });

        expect(data).toBe(fixture.b.id);
        const { data: mine } = await outsider.client.rpc(
          "household_ids_for_current_user",
        );
        expect(mine).toEqual([fixture.b.id]);
      } finally {
        await outsider.remove();
      }
    });

    it("cannot be redeemed without a session at all", async () => {
      const { token } = await issue(fixture.a.id);
      const { createSupabaseClient } = await import("@/lib/supabase/client");

      const { error } = await createSupabaseClient().rpc("accept_household_invite", {
        p_token_hash: hashInviteToken(token),
      });

      // Refused by the grant, not by a bad token: 42501 is "permission
      // denied for function". There is no anonymous path into a Household at
      // all, which is what makes auth.uid() inside it safe to trust.
      expect(error?.code).toBe("42501");
    });
  });

  describe("a Household with two phones in it", () => {
    let second: Credential;

    beforeAll(async () => {
      second = await createCredential("second-phone");
      const { token } = await issue(fixture.a.id);
      const { data } = await second.client.rpc("accept_household_invite", {
        p_token_hash: hashInviteToken(token),
      });
      expect(data).toBe(fixture.a.id);
    });

    afterAll(async () => {
      await second?.remove();
    });

    it("shows the second phone exactly the first's Entries", async () => {
      // Story 2: one family record, not two.
      const [mine, theirs] = await Promise.all([
        fixture.a.client.from("entries").select("id, title").order("title"),
        second.client.from("entries").select("id, title").order("title"),
      ]);

      expect(theirs.data).toEqual(mine.data);
      expect(theirs.data?.map((row) => row.title)).toContain("A's pizza");
    });

    it("lets the second phone record an Entry the first can see", async () => {
      // Story 3: it does not matter who was holding the camera.
      const { data: saved, error } = await second.client
        .from("entries")
        .insert({
          household_id: fixture.a.id,
          place_id: fixture.sharedPlaceId,
          title: "Second phone's dessert",
          photo_path: `${fixture.a.id}/second.jpg`,
          thumbnail_path: `${fixture.a.id}/second-thumb.webp`,
          width: 1,
          height: 1,
          captured_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      const { data: asFirst } = await fixture.a.client
        .from("entries")
        .select("id")
        .eq("id", saved!.id)
        .maybeSingle();

      expect(asFirst?.id).toBe(saved!.id);
    });

    it("records nothing about which member saved an Entry", async () => {
      // CONTEXT.md is explicit that no Entry records which family member ate
      // the dish, and #49 says adding a second member must not quietly
      // introduce one. This is that promise, asserted against the columns.
      const { data } = await fixture.a.client
        .from("entries")
        .select("*")
        .limit(1)
        .single();

      expect(Object.keys(data!)).not.toContain("user_id");
      expect(Object.keys(data!)).not.toContain("created_by");
      expect(Object.keys(data!)).not.toContain("member_id");
    });

    it("still shows neither phone anything of the other Household", async () => {
      // The isolation tests elsewhere use single-member Households. This is
      // the same boundary once a Household has two: more members must not
      // mean a wider view.
      for (const client of [fixture.a.client, second.client]) {
        const { data } = await client
          .from("entries")
          .select("title")
          .eq("place_id", fixture.bOnlyPlaceId);

        expect(data).toEqual([]);
      }
    });

    it("lists both phones, with their emails, to either of them", async () => {
      const { data } = await second.client.rpc("household_members_for_current_user");

      expect(data?.map((row) => row.user_id)).toContain(second.userId);
      expect(data).toHaveLength(2);
      expect(data?.every((row) => row.email.includes("@"))).toBe(true);
    });
  });

  describe("revoking a membership", () => {
    it("ends that phone's access at once", async () => {
      // Story 4. No cached grant, no session to wait out: the next read is
      // already empty.
      const phone = await createCredential("lost-phone");
      try {
        const { token } = await issue(fixture.a.id);
        await phone.client.rpc("accept_household_invite", {
          p_token_hash: hashInviteToken(token),
        });

        const before = await phone.client.from("entries").select("id");
        expect(before.data?.length).toBeGreaterThan(0);

        const { error } = await fixture.a.client
          .from("household_members")
          .delete()
          .eq("user_id", phone.userId);
        expect(error).toBeNull();

        const after = await phone.client.from("entries").select("id");
        expect(after.data).toEqual([]);
      } finally {
        await phone.remove();
      }
    });

    it("refuses to remove a member of another Household", async () => {
      const { count } = await fixture.a.client
        .from("household_members")
        .delete({ count: "exact" })
        .eq("household_id", fixture.b.id);

      expect(count).toBe(0);
    });

    it("refuses to remove yourself, so a Household keeps at least one member", async () => {
      const { data: me } = await fixture.a.client.auth.getUser();

      const { count } = await fixture.a.client
        .from("household_members")
        .delete({ count: "exact" })
        .eq("user_id", me.user!.id);

      expect(count).toBe(0);
    });
  });
});
