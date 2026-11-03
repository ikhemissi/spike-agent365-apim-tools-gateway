// The public settings the page needs: sign-in (tenant, client id, scope, origin, the gateway scope when set), title
// and intro. No secrets.
import { getConfig, publicConfig } from "@/lib/server/config";
import { reportError } from "@/lib/server/errors";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(publicConfig(getConfig()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, body } = reportError(error, randomUUID());
    return Response.json(body, { status });
  }
}
