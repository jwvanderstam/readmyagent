import { getConfig } from "@/lib/config";
import { hasBearer } from "@/lib/security/bearer";
import { syncNow } from "@/lib/sync/server";

// Daily Vercel cron (vercel.json). Vercel sends `Authorization: Bearer ${CRON_SECRET}`
// (SECURITY.md T5). Without a configured secret the endpoint does not exist.
export async function GET(request: Request) {
  const { cronSecret } = getConfig();
  if (!cronSecret) {
    return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
  if (!hasBearer(request.headers.get("authorization"), cronSecret)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Invalid cron secret." } },
      { status: 401 },
    );
  }

  const result = await syncNow("cron");
  if (result.status === "disabled" || result.status === "busy") {
    return Response.json({ data: { status: result.status } });
  }
  return Response.json({ data: result }, { status: result.status === "failed" ? 500 : 200 });
}
