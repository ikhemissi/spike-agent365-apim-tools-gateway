// Foundry mode: starts the hosted agent's session for a new chat (lib/server/session-handler.ts).
import { handleSessionRequest } from "@/lib/server/session-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return handleSessionRequest(request);
}
