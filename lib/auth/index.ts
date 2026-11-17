import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { getConfig } from "@/lib/config";
import { auth } from "./auth";
import { sameEmail } from "./policy";

export { auth, handlers, signIn, signOut } from "./auth";

/**
 * The owner's session, or null. Pages and handlers call this themselves even though proxy.ts
 * already checked the request (ADR-0003: middleware enforces, handlers check again).
 */
export async function getOwnerSession(): Promise<Session | null> {
  const session = await auth();
  return sameEmail(session?.user?.email, getConfig().ownerEmail) ? session : null;
}

/** For pages and Server Actions: the owner's session, or a redirect to sign-in. */
export async function requireOwner(): Promise<Session> {
  const session = await getOwnerSession();
  if (!session) redirect("/signin");
  return session;
}

/** For route handlers: null when the owner is signed in, otherwise a 401 response. */
export async function ownerOrUnauthorized(): Promise<Response | null> {
  if (await getOwnerSession()) return null;
  return Response.json(
    { error: { code: "unauthorized", message: "Sign in as the owner." } },
    { status: 401 },
  );
}
