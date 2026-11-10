// The settings the server accepts, and the part the browser is given.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gatewayScope, getConfig, publicConfig, responsesUrl } from "../lib/server/config";
import { apimEnvironment } from "./apim-helpers";
import { environment, id } from "./helpers";

test("reads the settings, with defaults for the scope, the development origin and the chat's texts", () => {
  const config = getConfig(environment);
  assert.equal(config.CHAT_GATEWAY, "litellm");
  assert.equal(config.GATEWAY_URL, "https://litellm.example.com");
  assert.equal(config.UI_SCOPE, "Chat.Use");
  assert.equal(config.UI_ORIGIN, "http://localhost:3000");
  assert.deepEqual(config.ALLOWED_USER_OBJECT_IDS, [id(5), id(6)]);
  assert.equal(config.CHAT_TITLE, "Chat");
  assert.match(config.CHAT_INSTRUCTIONS, /MCP tools/);
});

test("the allowed-user list is optional", () => {
  assert.equal(getConfig({ ...environment, ALLOWED_USER_OBJECT_IDS: undefined }).ALLOWED_USER_OBJECT_IDS, undefined);
});

test("the title, intro and instructions are settings", () => {
  const config = getConfig({ ...environment, CHAT_TITLE: "Team notes", CHAT_INTRO: "Notes for the team.",
    CHAT_INSTRUCTIONS: "Add and list notes when asked." });
  assert.equal(config.CHAT_TITLE, "Team notes");
  assert.equal(config.CHAT_INTRO, "Notes for the team.");
  assert.equal(config.CHAT_INSTRUCTIONS, "Add and list notes when asked.");
});

test("the browser gets the sign-in settings, title and intro only, never the gateway, its key or the instructions", () => {
  const config = getConfig({ ...environment, UI_ORIGIN: "https://chat.example.com", CHAT_INTRO: "Hello." });
  assert.deepEqual(publicConfig(config), {
    tenantId: id(1), clientId: id(2), scope: `api://${id(2)}/Chat.Use`, origin: "https://chat.example.com",
    title: "Chat", intro: "Hello.",
  });
});

test("without GATEWAY_SCOPE the guardrail settings are off", () => {
  assert.equal(gatewayScope(getConfig(environment)), undefined);
});

test("with GATEWAY_SCOPE the browser gets the scope, and the server the gateway's app id and scope name", () => {
  const config = getConfig({ ...environment, GATEWAY_SCOPE: `api://${id(3)}/Tools.Use` });
  assert.equal(publicConfig(config).gatewayScope, `api://${id(3)}/Tools.Use`);
  assert.deepEqual(gatewayScope(config), { audience: id(3), scopeName: "Tools.Use" });
});

test("accepts HTTPS origins and loopback HTTP origins for development", () => {
  for (const origin of ["https://chat.example.com", "http://localhost:3000", "http://127.0.0.1:3000"]) {
    assert.equal(getConfig({ ...environment, UI_ORIGIN: origin }).UI_ORIGIN, origin);
  }
});

for (const [label, overrides] of [
  ["an HTTP gateway", { GATEWAY_URL: "http://litellm.example.com" }],
  ["a gateway URL with credentials", { GATEWAY_URL: "https://user:pass@litellm.example.com" }],
  ["a missing key", { LITELLM_API_KEY: undefined }],
  ["a missing model", { CHAT_MODEL: undefined }],
  ["a tenant that is not a GUID", { UI_TENANT_ID: "contoso.onmicrosoft.com" }],
  ["an HTTP origin that is not loopback", { UI_ORIGIN: "http://chat.example.com" }],
  ["an origin with a path", { UI_ORIGIN: "https://chat.example.com/app" }],
  ["an empty allowed-user list", { ALLOWED_USER_OBJECT_IDS: " , " }],
  ["an allowed user that is not a GUID", { ALLOWED_USER_OBJECT_IDS: `${id(5)},someone@example.com` }],
  ["a gateway scope whose app id is not a GUID", { GATEWAY_SCOPE: "api://litellm-gateway/Tools.Use" }],
  ["a gateway scope that is not an api:// scope", { GATEWAY_SCOPE: `https://${id(3)}/Tools.Use` }],
  ["a gateway scope without a scope name", { GATEWAY_SCOPE: `api://${id(3)}` }],
  ["an empty title", { CHAT_TITLE: "" }],
  ["an empty set of instructions", { CHAT_INSTRUCTIONS: "" }],
] as const) {
  test(`refuses ${label}`, () => {
    assert.throws(() => getConfig({ ...environment, ...overrides }));
  });
}

test("errors name the setting, never its value", () => {
  assert.throws(() => getConfig({ ...environment, LITELLM_API_KEY: "sk-secret value" }), (error: Error) =>
    error.message.includes("LITELLM_API_KEY") && !error.message.includes("sk-secret"));
});

test("API Management mode reads the MCP servers and needs no LiteLLM key, and ignores one that is set", () => {
  for (const env of [apimEnvironment, { ...apimEnvironment, LITELLM_API_KEY: undefined }]) {
    const config = getConfig(env);
    assert.equal(config.CHAT_GATEWAY, "apim");
    assert.equal(config.GATEWAY_URL, "https://apim.example.com/openai/v1");
    assert.deepEqual(config.CHAT_GATEWAY === "apim" && config.MCP_SERVERS, [
      { label: "notes", url: "https://apim.example.com/notes/mcp" },
      { label: "files", url: "https://apim.example.com/files/mcp" },
    ]);
    assert.equal("LITELLM_API_KEY" in config, false);
  }
});

test("the Responses API is at /v1/responses below LiteLLM's URL, and at /responses below API Management's /openai/v1", () => {
  assert.equal(responsesUrl(getConfig(environment)), "https://litellm.example.com/v1/responses");
  assert.equal(responsesUrl(getConfig(apimEnvironment)), "https://apim.example.com/openai/v1/responses");
});

for (const [label, overrides] of [
  ["a gateway that is neither litellm nor apim", { CHAT_GATEWAY: "kong" }],
  ["API Management mode without GATEWAY_SCOPE", { GATEWAY_SCOPE: undefined }],
  ["API Management mode without MCP_SERVERS", { MCP_SERVERS: undefined }],
  ["API Management mode with an empty MCP_SERVERS", { MCP_SERVERS: " , " }],
  ["an MCP server without a label", { MCP_SERVERS: "https://apim.example.com/notes/mcp" }],
  ["an MCP server label with capitals", { MCP_SERVERS: "Notes=https://apim.example.com/notes/mcp" }],
  ["an MCP server label starting with a digit", { MCP_SERVERS: "1notes=https://apim.example.com/notes/mcp" }],
  ["an MCP server label with a dash", { MCP_SERVERS: "team-notes=https://apim.example.com/notes/mcp" }],
  ["an MCP server label over 31 characters", { MCP_SERVERS: `n${"o".repeat(31)}=https://apim.example.com/notes/mcp` }],
  ["an HTTP MCP server", { MCP_SERVERS: "notes=http://apim.example.com/notes/mcp" }],
  ["an MCP server URL with a query", { MCP_SERVERS: "notes=https://apim.example.com/notes/mcp?code=secret" }],
  ["an MCP server URL that is not a URL", { MCP_SERVERS: "notes=apim notes" }],
  ["two MCP servers with the same label", { MCP_SERVERS: "notes=https://a.example.com/mcp,notes=https://b.example.com/mcp" }],
  ["an HTTP API Management URL", { GATEWAY_URL: "http://apim.example.com/openai/v1" }],
] as const) {
  test(`refuses ${label}`, () => {
    assert.throws(() => getConfig({ ...apimEnvironment, ...overrides }));
  });
}

test("in LiteLLM mode GATEWAY_SCOPE stays optional and the key required, as before", () => {
  assert.equal(getConfig({ ...environment, CHAT_GATEWAY: "litellm" }).GATEWAY_SCOPE, undefined);
  assert.throws(() => getConfig({ ...environment, CHAT_GATEWAY: "litellm", LITELLM_API_KEY: undefined }), /LITELLM_API_KEY/);
});

test("MCP server errors name the setting, never the URL", () => {
  assert.throws(() => getConfig({ ...apimEnvironment, MCP_SERVERS: "notes=http://apim.example.com/secret-path" }), (error: Error) =>
    error.message.includes("MCP_SERVERS") && !error.message.includes("secret-path"));
});
