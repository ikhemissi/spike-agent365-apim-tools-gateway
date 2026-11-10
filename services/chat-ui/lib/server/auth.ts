// Checks the browser's Entra access tokens: the sign-in token (a delegated token for this app, from an allowed user)
// and, when GATEWAY_SCOPE is set (LiteLLM's Agent 365 guardrail, or API Management), the same user's token for the gateway.
// In Foundry mode, also the same user's token for Foundry (verifyFoundryToken).
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ChatConfig, GatewayScope } from "./config";
import { ChatError } from "./errors";

export interface AuthenticatedUser {
  oid: string;
  tid: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

function tenantKeys(tenant: string): JWTVerifyGetKey {
  let keys = keySets.get(tenant);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
    keySets.set(tenant, keys);
  }
  return keys;
}

export async function authenticate(
  authorization: string | null,
  config: ChatConfig,
  getKey: JWTVerifyGetKey = tenantKeys(config.UI_TENANT_ID),
): Promise<AuthenticatedUser> {
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  if (!match) throw new ChatError("authentication", "missing_token", "Sign in before using the chat.", 401);
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(match[1], getKey, {
      algorithms: ["RS256"],
      issuer: `https://login.microsoftonline.com/${config.UI_TENANT_ID}/v2.0`,
      audience: config.UI_CLIENT_ID,
      requiredClaims: ["exp", "iat", "oid", "tid", "azp", "scp"],
    }));
  } catch {
    throw new ChatError("authentication", "invalid_token", "The sign-in token is invalid or expired. Sign in again.", 401);
  }
  // One app registration is both the SPA and the API, so the caller (azp) must be this app too.
  const delegated = claims.tid === config.UI_TENANT_ID && claims.azp === config.UI_CLIENT_ID
    && claims.idtyp !== "app" && typeof claims.scp === "string"
    && claims.scp.split(" ").includes(config.UI_SCOPE);
  if (!delegated) {
    throw new ChatError("authentication", "invalid_delegation", "A delegated token from this chat's sign-in is required.", 403);
  }
  const allowedUsers = config.ALLOWED_USER_OBJECT_IDS;
  if (typeof claims.oid !== "string" || (allowedUsers !== undefined && !allowedUsers.includes(claims.oid))) {
    throw new ChatError("authentication", "user_not_allowed", "This user is not allowed to use the chat.", 403);
  }
  return { oid: claims.oid, tid: config.UI_TENANT_ID };
}

// The gateway (LiteLLM's Agent 365 guardrail, or API Management and the MCP servers behind it) acts on behalf of
// whoever this token names, so it must be a delegated token this chat obtained for the user who signed in, never one
// pasted in for someone else.
export async function verifyGatewayToken(
  token: string | null,
  gateway: GatewayScope,
  user: AuthenticatedUser,
  config: ChatConfig,
  getKey: JWTVerifyGetKey = tenantKeys(config.UI_TENANT_ID),
): Promise<string> {
  if (!token) {
    throw new ChatError("authentication", "missing_gateway_token", "The chat needs your token for the gateway. Sign in again.", 401);
  }
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(token, getKey, {
      algorithms: ["RS256"],
      issuer: `https://login.microsoftonline.com/${config.UI_TENANT_ID}/v2.0`,
      audience: gateway.audience,
      requiredClaims: ["exp", "iat", "oid", "tid", "azp", "scp"],
    }));
  } catch {
    throw new ChatError("authentication", "invalid_gateway_token", "The gateway token is invalid or expired. Sign in again.", 401);
  }
  const delegated = claims.azp === config.UI_CLIENT_ID && claims.idtyp !== "app"
    && typeof claims.scp === "string" && claims.scp.split(" ").includes(gateway.scopeName);
  if (!delegated) {
    throw new ChatError("authentication", "invalid_gateway_delegation", "A delegated gateway token from this chat's sign-in is required.", 403);
  }
  if (claims.oid !== user.oid || claims.tid !== user.tid) {
    throw new ChatError("authentication", "gateway_user_mismatch", "The gateway token belongs to another user. Sign in again.", 403);
  }
  return token;
}

// Foundry mode: the hosted agent's endpoint and the agents it calls (over A2A, through the gateway) act for whoever
// this token names, so it too must be a delegated token this chat obtained for the signed-in user. Foundry's API
// (https://ai.azure.com) issues v1 tokens: the issuer is sts.windows.net and the client is in appid.
export async function verifyFoundryToken(
  token: string | null,
  user: AuthenticatedUser,
  config: ChatConfig,
  getKey: JWTVerifyGetKey = tenantKeys(config.UI_TENANT_ID),
): Promise<string> {
  if (!token) {
    throw new ChatError("authentication", "missing_foundry_token", "The chat needs your token for Foundry. Sign in again.", 401);
  }
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(token, getKey, {
      algorithms: ["RS256"],
      issuer: `https://sts.windows.net/${config.UI_TENANT_ID}/`,
      audience: "https://ai.azure.com",
      requiredClaims: ["exp", "iat", "oid", "tid", "appid", "scp"],
    }));
  } catch {
    throw new ChatError("authentication", "invalid_foundry_token", "The Foundry token is invalid or expired. Sign in again.", 401);
  }
  const delegated = claims.appid === config.UI_CLIENT_ID && claims.idtyp !== "app"
    && typeof claims.scp === "string" && claims.scp.split(" ").includes("user_impersonation");
  if (!delegated) {
    throw new ChatError("authentication", "invalid_foundry_delegation", "A delegated Foundry token from this chat's sign-in is required.", 403);
  }
  if (claims.oid !== user.oid || claims.tid !== user.tid) {
    throw new ChatError("authentication", "foundry_user_mismatch", "The Foundry token belongs to another user. Sign in again.", 403);
  }
  return token;
}
