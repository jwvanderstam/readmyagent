import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getConfig } from "@/lib/config";
import { isAllowedOwner } from "./policy";

// Lazy initialization: configuration is read per request, after proxy.ts has checked it, so a
// missing setting shows the setup page instead of crashing at import time.
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const config = getConfig();
  return {
    secret: config.auth.secret,
    // Vercel sets the forwarded host; the instance has no fixed URL in configuration.
    trustHost: true,
    session: { strategy: "jwt" },
    providers: [
      Google({
        clientId: config.auth.googleClientId,
        clientSecret: config.auth.googleClientSecret,
        // Sign-in only: minimal scopes (ADR-0003). Drive access is separate (ADR-0008).
        authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
      }),
    ],
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      signIn: ({ account, profile }) =>
        account?.provider === "google" && isAllowedOwner(profile, config.ownerEmail),
    },
  };
});
