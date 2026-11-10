// Who may use the chat: a delegated Entra token for this app, with the chat scope, from an allowed user (any user
// of the tenant without an allowed-user list);
// and, with the Agent 365 guardrail on, the same user's delegated token for the gateway.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticate, verifyGatewayToken } from "../lib/server/auth";
import { gatewayScope } from "../lib/server/config";
import { config, gatewayConfig, id } from "./helpers";

const keys = await generateKeyPair("RS256");
const getKey = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" }] });

async function signed(overrides: Record<string, unknown> = {}) {
  const { iss, aud, exp, ...claims } = overrides;
  return new SignJWT({ tid: config.UI_TENANT_ID, oid: id(5), azp: config.UI_CLIENT_ID, scp: "Chat.Use", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(typeof iss === "string" ? iss : `https://login.microsoftonline.com/${config.UI_TENANT_ID}/v2.0`)
    .setAudience(typeof aud === "string" ? aud : config.UI_CLIENT_ID)
    .setIssuedAt().setExpirationTime(typeof exp === "number" ? exp : "5m").sign(keys.privateKey);
}

test("an allowed user's delegated token is accepted", async () => {
  assert.deepEqual(await authenticate(`Bearer ${await signed()}`, config, getKey), { oid: id(5), tid: id(1) });
  assert.deepEqual(await authenticate(`Bearer ${await signed({ oid: id(6), scp: "openid Chat.Use" })}`, config, getKey),
    { oid: id(6), tid: id(1) });
});

test("without an allowed-user list, any user's delegated token for this chat is accepted", async () => {
  const anyUserConfig = { ...config, ALLOWED_USER_OBJECT_IDS: undefined };
  assert.deepEqual(await authenticate(`Bearer ${await signed({ oid: id(20) })}`, anyUserConfig, getKey),
    { oid: id(20), tid: id(1) });
  await assert.rejects(authenticate(`Bearer ${await signed({ oid: id(20), tid: id(21) })}`, anyUserConfig, getKey),
    (error: { status: number }) => error.status === 403);
});

for (const [label, overrides, status] of [
  ["another tenant", { tid: id(20) }, 403], ["another client app", { azp: id(20) }, 403],
  ["a user not in the allowed list", { oid: id(20) }, 403], ["a token without the chat scope", { scp: "User.Read" }, 403],
  ["an application token", { idtyp: "app" }, 403], ["another audience", { aud: id(20) }, 401],
  ["another issuer", { iss: "https://login.microsoftonline.com/common/v2.0" }, 401], ["an expired token", { exp: 1 }, 401],
  ["a token without scp", { scp: undefined }, 401],
] as const) {
  test(`refuses ${label} (${status})`, async () => {
    await assert.rejects(authenticate(`Bearer ${await signed(overrides)}`, config, getKey),
      (error: { status: number }) => error.status === status);
  });
}

test("refuses missing, malformed and forged bearer tokens", async () => {
  for (const value of [null, "", "Basic abc", "Bearer a b", "Bearer ", `Bearer ${await signed()}forged`]) {
    await assert.rejects(authenticate(value, config, getKey));
  }
});

// The gateway's token for the signed-in user id(5): audience the gateway app id(3), scope Tools.Use, asked by this chat.
const gateway = gatewayScope(gatewayConfig)!;
const signedInUser = { oid: id(5), tid: id(1) };
const gatewayToken = (overrides: Record<string, unknown> = {}) => signed({ aud: id(3), scp: "Tools.Use", ...overrides });
const verifyGateway = (token: string | null) => verifyGatewayToken(token, gateway, signedInUser, gatewayConfig, getKey);

test("the signed-in user's delegated gateway token is accepted and passed on unchanged", async () => {
  const token = await gatewayToken();
  assert.equal(await verifyGateway(token), token);
});

for (const [label, overrides, status] of [
  ["a gateway token for another audience (the chat's own token)", { aud: config.UI_CLIENT_ID, scp: "Chat.Use" }, 401],
  ["a gateway token from another issuer", { iss: "https://login.microsoftonline.com/common/v2.0" }, 401],
  ["an expired gateway token", { exp: 1 }, 401],
  ["a gateway token for a different user", { oid: id(6) }, 403],
  ["a gateway token from another tenant", { tid: id(20) }, 403],
  ["a gateway token without the gateway scope", { scp: "User.Read" }, 403],
  ["a gateway token another app asked for", { azp: id(20) }, 403],
  ["an application token for the gateway", { idtyp: "app" }, 403],
] as const) {
  test(`refuses ${label} (${status})`, async () => {
    await assert.rejects(verifyGateway(await gatewayToken(overrides)), (error: { status: number }) => error.status === status);
  });
}

test("refuses a missing or forged gateway token (401), without repeating the token", async () => {
  for (const value of [null, "", `${await gatewayToken()}forged`]) {
    await assert.rejects(verifyGateway(value), (error: { status: number; message: string }) =>
      error.status === 401 && !(value && error.message.includes(value)));
  }
});
