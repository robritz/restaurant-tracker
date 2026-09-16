import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const updateSession = vi.fn();
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: (request: NextRequest) => updateSession(request),
}));

import { middleware } from "./middleware";

/**
 * The middleware only ever reads the URL off the request and hands the whole
 * thing to updateSession, which is mocked -- so a plain Request with the
 * NextRequest surface it actually touches is enough, and avoids standing up
 * Next's full request pipeline in a unit test.
 */
function request(path: string): NextRequest {
  const url = `https://tracker.test${path}`;
  return { nextUrl: new URL(url), url } as NextRequest;
}

function signedIn() {
  updateSession.mockResolvedValue({
    response: NextResponse.next(),
    user: { id: "user-uuid-1" },
  });
}

function signedOut() {
  updateSession.mockResolvedValue({ response: NextResponse.next(), user: null });
}

describe("middleware", () => {
  beforeEach(() => {
    updateSession.mockReset();
  });

  describe("without a session", () => {
    beforeEach(signedOut);

    it("redirects a page request to the login screen", async () => {
      const response = await middleware(request("/map"));

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location")!);
      expect(location.pathname).toBe("/login");
    });

    it("carries the requested path so signing in returns there", async () => {
      const response = await middleware(request("/map?place=place-uuid-1"));

      const location = new URL(response.headers.get("location")!);
      expect(location.searchParams.get("next")).toBe("/map?place=place-uuid-1");
    });

    it("answers an API request with 401 JSON rather than a redirect", async () => {
      const response = await middleware(request("/api/place-logs"));

      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      await expect(response.json()).resolves.toEqual({
        error: expect.any(String),
      });
    });

    it("guards the place search too, since it spends the Mapbox token", async () => {
      const response = await middleware(request("/api/places?q=diner"));

      expect(response.status).toBe(401);
    });

    it("lets the login screen through, or there would be nowhere to sign in", async () => {
      const response = await middleware(request("/login"));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    });

    it("lets the sign-in and sign-out routes through", async () => {
      await expect(
        middleware(request("/api/auth/login")).then((r) => r.status),
      ).resolves.toBe(200);
      await expect(
        middleware(request("/api/auth/logout")).then((r) => r.status),
      ).resolves.toBe(200);
    });
  });

  describe("with a session", () => {
    beforeEach(signedIn);

    it("lets a page request through", async () => {
      const response = await middleware(request("/map"));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    });

    it("lets an API request through", async () => {
      const response = await middleware(request("/api/place-logs"));

      expect(response.status).toBe(200);
    });

    it("sends a signed-in visitor away from the login screen", async () => {
      const response = await middleware(request("/login"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/");
    });
  });

  it("returns the response updateSession built, so a refreshed session's cookies survive", async () => {
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-auth-token", "refreshed");
    updateSession.mockResolvedValue({ response: refreshed, user: { id: "user-uuid-1" } });

    const response = await middleware(request("/map"));

    expect(response.cookies.get("sb-auth-token")?.value).toBe("refreshed");
  });
});
