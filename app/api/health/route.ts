// Public liveness probe (SECURITY.md T1). Reveals nothing about the instance.
export function GET() {
  return Response.json({ data: { status: "ok" } }, { headers: { "Cache-Control": "no-store" } });
}
