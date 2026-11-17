import { ownerOrUnauthorized } from "@/lib/auth";
import { syncNow } from "@/lib/sync/server";

// Manual sync by the owner (architecture 6.1).
export async function POST() {
  const denied = await ownerOrUnauthorized();
  if (denied) return denied;

  const result = await syncNow("manual");
  if (result.status === "disabled") {
    return Response.json(
      {
        error: { code: "sync_disabled", message: "Drive is not configured for this environment." },
      },
      { status: 409 },
    );
  }
  if (result.status === "busy") {
    return Response.json(
      { error: { code: "sync_running", message: "A sync is already running." } },
      { status: 409 },
    );
  }
  return Response.json({ data: result }, { status: result.status === "failed" ? 500 : 200 });
}
