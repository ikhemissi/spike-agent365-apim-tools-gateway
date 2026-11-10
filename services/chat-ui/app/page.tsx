"use client";
// The page: loads the public sign-in settings, starts MSAL, then shows the chat.

import { useEffect, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { SignedInChat, type ExtraToken } from "./providers";

// Next to the sign-in scope, the user's own tokens the server asks for: for the gateway when it needs one (LiteLLM's
// Agent 365 guardrail, or API Management), and for Foundry in Foundry mode.
interface Scopes {
  scope: string;
  extraTokens: ExtraToken[];
}

function extraTokens(config: { gatewayScope?: string; foundryScope?: string }): ExtraToken[] {
  const tokens: ExtraToken[] = [];
  if (config.gatewayScope) tokens.push({ header: "x-gateway-token", scope: config.gatewayScope });
  if (config.foundryScope) tokens.push({ header: "x-foundry-token", scope: config.foundryScope });
  return tokens;
}

interface Heading {
  title: string;
  intro: string;
}

let initialization: Promise<{ app: PublicClientApplication; scopes: Scopes; heading: Heading }> | undefined;

async function initialize() {
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok) throw new Error("The chat's configuration is incomplete. Check the server settings.");
  const config = await response.json();
  const app = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: `${config.origin}/auth/callback`,
      postLogoutRedirectUri: `${config.origin}/auth/callback`,
    },
    // Tokens live only as long as the page: nothing is kept in browser storage.
    cache: { cacheLocation: "memoryStorage" },
  });
  await app.initialize();
  return {
    app,
    scopes: { scope: config.scope, extraTokens: extraTokens(config) },
    heading: { title: config.title, intro: config.intro },
  };
}

export default function Page() {
  const [instance, setInstance] = useState<PublicClientApplication>();
  const [scopes, setScopes] = useState<Scopes>({ scope: "", extraTokens: [] });
  const [heading, setHeading] = useState<Heading>({ title: "Chat", intro: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    initialization ??= initialize();
    initialization.then(({ app, scopes, heading }) => {
      if (!disposed) {
        setScopes(scopes);
        setHeading(heading);
        document.title = heading.title;
        setInstance(app);
      }
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : "Could not initialize sign-in.");
    });
    return () => { disposed = true; };
  }, []);
  return <main>
    <header><p className="eyebrow">MCP TOOLS THROUGH A GATEWAY</p><h1>{heading.title}</h1>
      {heading.intro && <p>{heading.intro}</p>}</header>
    {error ? <section role="alert">{error}</section>
      : instance ? <MsalProvider instance={instance}><SignedInChat scope={scopes.scope} extraTokens={scopes.extraTokens} /></MsalProvider>
        : <p role="status">Preparing Microsoft sign-in...</p>}
  </main>;
}
