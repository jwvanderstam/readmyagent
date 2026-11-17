import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/auth/policy";
import { validateConfig } from "@/lib/config/validate";

export const SETUP_PATH = "/setup";
export const SIGNIN_PATH = "/signin";

/** Content Security Policy with a per-request nonce (SECURITY.md T2). No `unsafe-inline`. */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const json = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/**
 * Runs in front of every request (proxy.ts).
 *
 * 1. Fail closed on configuration (ADR-0007): pages show only the setup page, API routes 503.
 * 2. Owner only (ADR-0003, SECURITY.md T1): the session JWT is decrypted and its email compared
 *    with OWNER_EMAIL. Pages without a valid session go to sign-in, API routes get 401.
 * 3. Sets the CSP with a fresh nonce, which Next.js applies to its own scripts.
 */
export async function guardRequest(
  request: NextRequest,
  env: Record<string, string | undefined>,
): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const result = validateConfig(env);

  if (!result.ok && pathname.startsWith("/api/")) {
    return json(503, "not_configured", "The instance is not fully configured.");
  }

  if (result.ok) {
    const token = await getToken({
      req: request,
      secret: result.config.auth.secret,
      secureCookie: request.nextUrl.protocol === "https:",
    });
    const decision = decideAccess(pathname, token?.email, result.config.ownerEmail);
    if (decision === "unauthorized") return json(401, "unauthorized", "Sign in as the owner.");
    if (decision === "signin") {
      const signin = new URL(SIGNIN_PATH, request.url);
      signin.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(signin);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response =
    !result.ok && pathname !== SETUP_PATH
      ? NextResponse.rewrite(new URL(SETUP_PATH, request.url), {
          request: { headers: requestHeaders },
        })
      : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
