import { NextResponse, type NextRequest } from "next/server";
import { validateConfig } from "@/lib/config/validate";

export const SETUP_PATH = "/setup";

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
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Runs in front of every request (proxy.ts).
 *
 * - Fail closed (ADR-0007): with an incomplete configuration, pages show only the setup page and
 *   API routes answer 503. Nothing else is reachable, including sign-in.
 * - Sets the CSP with a fresh nonce, which Next.js applies to its own scripts.
 */
export function guardRequest(
  request: NextRequest,
  env: Record<string, string | undefined>,
): NextResponse {
  const { pathname } = request.nextUrl;
  const configured = validateConfig(env).ok;

  if (!configured && pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "The instance is not fully configured." } },
      { status: 503 },
    );
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response =
    !configured && pathname !== SETUP_PATH
      ? NextResponse.rewrite(new URL(SETUP_PATH, request.url), {
          request: { headers: requestHeaders },
        })
      : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}
