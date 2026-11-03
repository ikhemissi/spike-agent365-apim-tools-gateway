"use client";
// The page: loads the public sign-in settings, starts MSAL, then shows the chat.

import { useEffect, useState } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { SignedInChat } from "./providers";

// gatewayScope is set when the gateway needs the user's own token: LiteLLM's Agent 365 guardrail, or API Management.
interface Scopes {
  scope: string;
  gatewayScope?: string;
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
    scopes: { scope: config.scope, gatewayScope: config.gatewayScope },
    heading: { title: config.title, intro: config.intro },
  };
}

export default function Page() {
  const [instance, setInstance] = useState<PublicClientApplication>();
  const [scopes, setScopes] = useState<Scopes>({ scope: "" });
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
      : instance ? <MsalProvider instance={instance}><SignedInChat scope={scopes.scope} gatewayScope={scopes.gatewayScope} /></MsalProvider>
        : <p role="status">Preparing Microsoft sign-in...</p>}
  </main>;
}
