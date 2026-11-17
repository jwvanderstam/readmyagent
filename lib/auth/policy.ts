// Access rules for a single-owner instance (ADR-0003). Pure, so they can be tested without
// Auth.js or a request.

/** Routes reachable without a session (SECURITY.md T1). */
const PUBLIC_PREFIXES = ["/api/auth/", "/api/cron/"];
const PUBLIC_PATHS = new Set(["/signin", "/setup", "/api/health"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export const sameEmail = (a: string | null | undefined, b: string) =>
  typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Only the configured owner may sign in, and only with an address Google has verified. Checked in
 * the Auth.js `signIn` callback, before a session exists.
 */
export function isAllowedOwner(
  profile: { email?: string | null; email_verified?: boolean | null } | undefined,
  ownerEmail: string,
): boolean {
  return profile?.email_verified === true && sameEmail(profile.email, ownerEmail);
}

export type AccessDecision = "allow" | "signin" | "unauthorized";

export function decideAccess(
  pathname: string,
  sessionEmail: string | null | undefined,
  ownerEmail: string,
): AccessDecision {
  if (isPublicPath(pathname)) return "allow";
  if (sameEmail(sessionEmail, ownerEmail)) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "signin";
}

/** Accept only same-origin relative paths as a post-sign-in destination (no open redirect). */
export function safeCallbackPath(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
