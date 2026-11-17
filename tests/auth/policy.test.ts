import { describe, expect, it } from "vitest";
import { decideAccess, isAllowedOwner, isPublicPath, safeCallbackPath } from "@/lib/auth/policy";

const OWNER = "owner@example.com";

describe("isAllowedOwner", () => {
  it("allows only the owner's verified address, case-insensitively", () => {
    expect(isAllowedOwner({ email: "Owner@Example.com", email_verified: true }, OWNER)).toBe(true);
    expect(isAllowedOwner({ email: OWNER, email_verified: false }, OWNER)).toBe(false);
    expect(isAllowedOwner({ email: OWNER }, OWNER)).toBe(false);
    expect(isAllowedOwner({ email: "other@example.com", email_verified: true }, OWNER)).toBe(false);
    expect(isAllowedOwner(undefined, OWNER)).toBe(false);
  });
});

describe("decideAccess", () => {
  it.each(["/signin", "/setup", "/api/health", "/api/auth/callback/google", "/api/cron/sync"])(
    "lets %s through without a session",
    (path) => {
      expect(isPublicPath(path)).toBe(true);
      expect(decideAccess(path, null, OWNER)).toBe("allow");
    },
  );

  it("sends pages without an owner session to sign-in and answers API routes with 401", () => {
    expect(decideAccess("/", null, OWNER)).toBe("signin");
    expect(decideAccess("/items/1", "other@example.com", OWNER)).toBe("signin");
    expect(decideAccess("/api/sync", null, OWNER)).toBe("unauthorized");
    expect(decideAccess("/", OWNER, OWNER)).toBe("allow");
    expect(decideAccess("/api/sync", OWNER, OWNER)).toBe("allow");
  });

  it("does not treat look-alike paths as public", () => {
    expect(isPublicPath("/signin/extra")).toBe(false);
    expect(isPublicPath("/api/authx")).toBe(false);
    expect(isPublicPath("/api/healthz")).toBe(false);
  });
});

describe("safeCallbackPath", () => {
  it.each([
    [undefined, "/"],
    [["/a", "/b"], "/"],
    ["/items/1?x=2", "/items/1?x=2"],
    ["https://evil.example.com", "/"],
    ["//evil.example.com", "/"],
    ["/\\evil.example.com", "/"],
    ["items", "/"],
  ])("%j becomes %j", (input, expected) => {
    expect(safeCallbackPath(input)).toBe(expected);
  });
});
