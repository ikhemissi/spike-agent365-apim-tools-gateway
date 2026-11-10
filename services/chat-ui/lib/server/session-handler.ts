// /api/session (Foundry mode): the page asks for the hosted agent's session as soon as a chat opens, so that the
// agent's container is running by the time the first message is sent. Same checks as the chat (origin, sign-in, the
// user's Foundry token), then the session is started as the user, in the background, for this user and thread.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticate, verifyFoundryToken } from "./auth";
import { getConfig } from "./config";
import { ChatError, reportError } from "./errors";
import { createFoundrySession } from "./foundry";
import { sessionKey, startSession } from "./foundry-sessions";
import { foundryTokenHeader } from "./handler";

const bodySchema = z.object({ threadId: z.string().uuid() });

export async function handleSessionRequest(
  request: Request,
  dependencies: {
    config?: typeof getConfig;
    authenticate?: typeof authenticate;
    verifyFoundryToken?: typeof verifyFoundryToken;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const config = (dependencies.config ?? getConfig)();
    if (config.CHAT_GATEWAY !== "foundry") throw new ChatError("request", "not_foundry", "Only the Foundry mode has sessions.", 404);
    const origin = request.headers.get("origin");
    if (origin && origin !== config.UI_ORIGIN) throw new ChatError("request", "invalid_origin", "This origin is not permitted.", 403);
    const user = await (dependencies.authenticate ?? authenticate)(request.headers.get("authorization"), config);
    const foundryToken = await (dependencies.verifyFoundryToken ?? verifyFoundryToken)(
      request.headers.get(foundryTokenHeader), user, config,
    );
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) throw new ChatError("request", "invalid_thread", "Send the chat's thread id (a UUID).", 400);
    // Not awaited: the page does not wait for the session, and a message that comes first waits for it.
    // A failure is logged here; the chat's first message then starts a session itself.
    void startSession(sessionKey(user.oid, body.data.threadId), () =>
      createFoundrySession({ config, foundryToken, fetchImpl: dependencies.fetchImpl }).catch((error: unknown) => {
        reportError(error, requestId);
        throw error;
      }));
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    const { status, body } = reportError(error, requestId);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", "x-request-id": requestId } });
  }
}
