// Reads and checks the server settings from the environment; publicConfig is the part the browser may see.
// Two gateways: LiteLLM (it runs the MCP tools itself) or Azure API Management (a proxy: this server runs the tools).
import { z } from "zod";

const loopbackHosts = ["localhost", "127.0.0.1"];
const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const gatewayScopePattern = new RegExp(`^api://(${uuid})/([a-zA-Z][a-zA-Z0-9._]*)$`);
const gatewayScopeSchema = z.string().regex(gatewayScopePattern);

// No credentials, query or fragment: request paths are appended to it, and nothing secret may sit in a setting's URL.
function isPlainHttpsUrl(value: string): boolean {
  // zod still runs refinements after a failed .url() check, so an invalid URL must not throw here.
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
}

// MCP_SERVERS: "label=url,label=url". The label prefixes the server's tool names, as LiteLLM does ("notes-add_note").
const mcpServersSchema = z.string()
  .transform((value) => value.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf("=");
    return { label: separator < 0 ? "" : entry.slice(0, separator).trim(), url: entry.slice(separator + 1).trim() };
  }))
  .pipe(z.array(z.object({
    label: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    url: z.string().url().refine(isPlainHttpsUrl, "An HTTPS URL without credentials, query or fragment."),
  })).min(1).refine((servers) => new Set(servers.map((server) => server.label)).size === servers.length, "Labels must be unique."));

const commonSchema = z.object({
  // litellm: LiteLLM's base URL; apim: API Management's OpenAI v1 base (…/openai/v1). See responsesUrl.
  GATEWAY_URL: z.string().url(),
  CHAT_MODEL: z.string().regex(/^[\w.:/-]+$/),
  UI_TENANT_ID: z.string().uuid(),
  UI_CLIENT_ID: z.string().uuid(),
  UI_SCOPE: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._]*$/).default("Chat.Use"),
  UI_ORIGIN: z.string().url().default("http://localhost:3000"),
  ALLOWED_USER_OBJECT_IDS: z.string()
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1)),
  // The user's own token for the gateway is asked for: api://<gateway app id>/<scope name>.
  // Optional with LiteLLM (only for the Agent 365 guardrail), required with API Management.
  GATEWAY_SCOPE: gatewayScopeSchema.optional(),
  // What the page shows and what the model is told: set them for the project's own tools.
  CHAT_TITLE: z.string().min(1).max(80).default("Chat"),
  CHAT_INTRO: z.string().min(1).max(400).default("The assistant uses the MCP tools the gateway allows. Each tool call "
    + "is shown with its arguments and its result, or why it failed or was refused."),
  CHAT_INSTRUCTIONS: z.string().min(1).max(4_000).default("You help the user with the MCP tools available to you: use a "
    + "tool when it answers the request, and say plainly when a tool fails or is refused. Keep answers short."),
});

// One shape per gateway, so that each mode only has (and the types only offer) the settings it uses:
// the LiteLLM key is not even read in apim mode, so it can never be sent to API Management.
const schema = z.discriminatedUnion("CHAT_GATEWAY", [
  commonSchema.extend({
    CHAT_GATEWAY: z.literal("litellm"),
    LITELLM_API_KEY: z.string().regex(/^\S+$/),
  }),
  commonSchema.extend({
    CHAT_GATEWAY: z.literal("apim"),
    GATEWAY_SCOPE: gatewayScopeSchema,
    MCP_SERVERS: mcpServersSchema,
  }),
]);

export type ChatConfig = z.infer<typeof schema>;
export type LiteLLMConfig = Extract<ChatConfig, { CHAT_GATEWAY: "litellm" }>;
export type ApimConfig = Extract<ChatConfig, { CHAT_GATEWAY: "apim" }>;
export type McpServerSetting = ApimConfig["MCP_SERVERS"][number];

export function getConfig(env: Record<string, string | undefined> = process.env): ChatConfig {
  const parsed = schema.safeParse({ ...env, CHAT_GATEWAY: env.CHAT_GATEWAY ?? "litellm" });
  if (!parsed.success) {
    // Names only: a value could be the key.
    throw new Error(`Chat configuration is missing or invalid: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  const config = parsed.data;
  if (!isPlainHttpsUrl(config.GATEWAY_URL)) {
    throw new Error("GATEWAY_URL must be an HTTPS URL without credentials, query or fragment.");
  }
  const origin = new URL(config.UI_ORIGIN);
  const isLoopbackHttp = origin.protocol === "http:" && loopbackHosts.includes(origin.hostname);
  if (origin.origin !== config.UI_ORIGIN || (origin.protocol !== "https:" && !isLoopbackHttp)) {
    throw new Error("UI_ORIGIN must be an HTTPS origin, or http://localhost or http://127.0.0.1 for development.");
  }
  return { ...config, GATEWAY_URL: config.GATEWAY_URL.replace(/\/+$/, "") };
}

// The two gateways put the Responses API at different paths below GATEWAY_URL: LiteLLM serves it at /v1/responses
// below its base URL, while API Management's OpenAI v1 API already ends in /openai/v1, so it is /responses there.
export function responsesUrl(config: ChatConfig): string {
  return config.CHAT_GATEWAY === "apim" ? `${config.GATEWAY_URL}/responses` : `${config.GATEWAY_URL}/v1/responses`;
}

export interface GatewayScope {
  audience: string;
  scopeName: string;
}

// The gateway's app id is the token audience; the scope name must be in the token's scp.
export function gatewayScope(config: ChatConfig): GatewayScope | undefined {
  const match = config.GATEWAY_SCOPE ? gatewayScopePattern.exec(config.GATEWAY_SCOPE) : null;
  return match ? { audience: match[1], scopeName: match[2] } : undefined;
}

export function publicConfig(config: ChatConfig) {
  return {
    tenantId: config.UI_TENANT_ID,
    clientId: config.UI_CLIENT_ID,
    scope: `api://${config.UI_CLIENT_ID}/${config.UI_SCOPE}`,
    origin: config.UI_ORIGIN,
    title: config.CHAT_TITLE,
    intro: config.CHAT_INTRO,
    ...(config.GATEWAY_SCOPE ? { gatewayScope: config.GATEWAY_SCOPE } : {}),
  };
}
