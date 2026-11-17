import { NextRequest } from "next/server";
import { getRewrittenUrl, isRewrite } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { buildCsp, guardRequest } from "@/lib/security/request-guard";

const configured = {
  DATABASE_URL: "postgresql://user:pw@db.example.com/app",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "secret",
  OWNER_EMAIL: "owner@example.com",
  APP_TIMEZONE: "Europe/Amsterdam",
  NODE_ENV: "production",
};

const request = (path: string) => new NextRequest(new URL(path, "https://app.example.com"));

describe("guardRequest", () => {
  it("rewrites every page to the setup page when the configuration is incomplete", () => {
    const response = guardRequest(request("/items/123"), {});
    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("https://app.example.com/setup");
  });

  it("serves the setup page itself without a rewrite", () => {
    expect(isRewrite(guardRequest(request("/setup"), {}))).toBe(false);
  });

  it("answers API routes with 503 when the configuration is incomplete", async () => {
    const response = guardRequest(request("/api/sync"), {});
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "not_configured", message: "The instance is not fully configured." },
    });
  });

  it("lets requests through and sets a CSP with a fresh nonce when configured", () => {
    const first = guardRequest(request("/"), configured);
    const second = guardRequest(request("/"), configured);
    expect(isRewrite(first)).toBe(false);

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
