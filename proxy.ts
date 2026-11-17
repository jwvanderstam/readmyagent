import type { NextRequest } from "next/server";
import { guardRequest } from "@/lib/security/request-guard";

export function proxy(request: NextRequest) {
  return guardRequest(request, process.env);
}

export const config = {
  matcher: [
    {
      // Everything except static assets. API routes are included so they fail closed too.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
