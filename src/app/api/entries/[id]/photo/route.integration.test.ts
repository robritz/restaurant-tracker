import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requireHousehold = vi.fn();
vi.mock("@/lib/auth/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/household")>()),
  requireHousehold: () => requireHousehold(),
}));

/**
 * The real service-role client, wrapped so the test can see whether the
 * route reached for the signer at all. "No URL is minted" is a claim about
 * what the route *did*, not about what came back -- checking the response
 * body for a token would pass just as well if the route signed a URL and
 * then threw it away.
 */
const signedPaths: string[] = [];
vi.mock("@/lib/supabase/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/client")>();
  return {
    ...actual,
    createSupabaseServiceRoleClient: () => {
      const client = actual.createSupabaseServiceRoleClient();
      const storageFrom = client.storage.from.bind(client.storage);
      client.storage.from = (bucket: string) => {
        const bucketApi = storageFrom(bucket);
        const createSignedUrl = bucketApi.createSignedUrl.bind(bucketApi);
        bucketApi.createSignedUrl = (path: string, ttl: number) => {
          signedPaths.push(path);
          return createSignedUrl(path, ttl);
        };
        return bucketApi;
      };
      return client;
    },
  };
});

import { GET } from "./route";
import { seedTwoHouseholds, type Fixture } from "@/test/households";

/**
 * #40 -- a dish photo opens only for your Household.
 *
 * A signed URL is bearer access to the photo, so the decision that matters
 * is whether one is minted at all. That decision is made in Postgres: the
 * route reads the Entry under RLS and signs nothing if the read comes back
 * empty. This exercises that against a real Entry owned by someone else.
 */
describe("GET /api/entries/[id]/photo (two Households, real database)", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await seedTwoHouseholds();
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  async function photoFor(household: "a" | "b", entryId: string) {
    signedPaths.length = 0;
    const { id, client } = fixture[household];
    requireHousehold.mockResolvedValue({ supabase: client, householdId: id });
    const response = await GET(new Request(`http://test/api/entries/${entryId}/photo`), {
      params: Promise.resolve({ id: entryId }),
    });
    return { response, body: await response.json() };
  }

  it("signs your own dish photo", async () => {
    const { response, body } = await photoFor("a", fixture.a.entryIds["A's pizza"]);

    expect(response.status).toBe(200);
    expect(body.url).toContain("token=");
  });

  it("refuses an Entry belonging to another Household", async () => {
    // A real, existing Entry id -- just not A's.
    const { response, body } = await photoFor("a", fixture.b.entryIds["B's ramen"]);

    expect(response.status).toBe(404);
    expect(body.url).toBeUndefined();
  });

  it("answers for someone else's Entry exactly as for one that never existed", async () => {
    // 404 and not 403: distinguishing the two would confirm that an Entry is
    // sitting there, which is the fact a Household is entitled to keep.
    const someoneElses = await photoFor("a", fixture.b.entryIds["B's croissant"]);
    const imaginary = await photoFor("a", "00000000-0000-0000-0000-000000000000");

    expect(someoneElses.response.status).toBe(imaginary.response.status);
    expect(someoneElses.body).toEqual(imaginary.body);
  });

  it("mints no URL at all for an Entry the caller does not own", async () => {
    // Not merely withheld from the response -- the signer is never called.
    // A URL that exists is a URL that can leak, however carefully the
    // response avoids mentioning it.
    await photoFor("a", fixture.b.entryIds["B's ramen"]);

    expect(signedPaths).toEqual([]);
  });

  it("signs exactly the one path it was asked for when you do own it", async () => {
    await photoFor("a", fixture.a.entryIds["A's pizza"]);

    expect(signedPaths).toHaveLength(1);
    // Photo paths lead with the Household, so this also shows whose object
    // was signed.
    expect(signedPaths[0].startsWith(`${fixture.a.id}/`)).toBe(true);
  });

  it("lets each Household open its own dish at a shared Place", async () => {
    const a = await photoFor("a", fixture.a.entryIds["A's pizza"]);
    const b = await photoFor("b", fixture.b.entryIds["B's ramen"]);

    expect(a.response.status).toBe(200);
    expect(b.response.status).toBe(200);
    expect(a.body.url).not.toBe(b.body.url);
  });
});
