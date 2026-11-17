import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { getRewrittenUrl, isRewrite } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { buildCsp, guardRequest } from "@/lib/security/request-guard";

const SECRET = "0123456789abcdef0123456789abcdef";
const OWNER = "owner@example.com";
const COOKIE = "__Secure-authjs.session-token";

const configured = {
  DATABASE_URL: "postgresql://user:pw@db.example.com/app",
  AUTH_SECRET: SECRET,
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "secret",
  OWNER_EMAIL: OWNER,
  APP_TIMEZONE: "Europe/Amsterdam",
  NODE_ENV: "production",
};

async function sessionCookie(email: string, secret = SECRET): Promise<string> {
  const token = await encode({ token: { email }, secret, salt: COOKIE });
  return `${COOKIE}=${token}`;
}

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "https://app.example.com"), {
    headers: cookie ? { cookie } : {},
  });
}

describe("guardRequest: configuration", () => {
  it("rewrites every page to the setup page when the configuration is incomplete", async () => {
    const response = await guardRequest(request("/items/123"), {});
    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("https://app.example.com/setup");
  });

  it("serves the setup page itself without a rewrite", async () => {
    expect(isRewrite(await guardRequest(request("/setup"), {}))).toBe(false);
  });

  it("answers API routes with 503 when the configuration is incomplete", async () => {
    const response = await guardRequest(request("/api/sync"), {});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "not_configured", message: "The instance is not fully configured." },
    });
  });
});

describe("guardRequest: owner only", () => {
  it("sends a page request without a session to sign-in, keeping the destination", async () => {
    const response = await guardRequest(request("/items/1?tab=feedback"), configured);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("callbackUrl")).toBe("/items/1?tab=feedback");
  });

  it("answers an API request without a session with 401", async () => {
    const response = await guardRequest(request("/api/sync"), configured);
    expect(response.status).toBe(401);
  });

  it("lets the owner through", async () => {
    const response = await guardRequest(request("/", await sessionCookie(OWNER)), configured);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a valid session of another account", async () => {
    const cookie = await sessionCookie("intruder@example.com");
    expect((await guardRequest(request("/api/sync", cookie), configured)).status).toBe(401);
  });

  it("rejects a session token encrypted with another secret", async () => {
    const cookie = await sessionCookie(OWNER, "another-secret-another-secret-12");
    expect((await guardRequest(request("/api/sync", cookie), configured)).status).toBe(401);
  });

  it("lets public routes through without a session", async () => {
    for (const path of ["/signin", "/api/health", "/api/auth/session"]) {
      expect((await guardRequest(request(path), configured)).status).toBe(200);
    }
  });

  it("sets a CSP with a fresh nonce per request", async () => {
    const first = await guardRequest(request("/signin"), configured);
    const second = await guardRequest(request("/signin"), configured);
    const csp = first.headers.get("Content-Security-Policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(second.headers.get("Content-Security-Policy")).not.toContain(nonce);
  });
});

describe("buildCsp", () => {
  it("has no unsafe-inline and allows eval only in development", () => {
    expect(buildCsp("abc", false)).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(buildCsp("abc", true)).toContain("'unsafe-eval'");
    expect(buildCsp("abc", false)).toContain("frame-ancestors 'none'");
  });
});
