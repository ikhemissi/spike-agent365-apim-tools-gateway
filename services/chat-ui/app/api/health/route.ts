// The container probe: unauthenticated, and independent of the settings so that it answers while they are wrong.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
