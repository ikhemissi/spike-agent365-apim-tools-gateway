"use client";
// The signed-in part of the page: keeps fresh access tokens and shows the CopilotKit chat with the server's agent.
// With a gateway scope, a second token (the same user's, for LiteLLM or API Management) goes in x-gateway-token.

import {
  AuthError, InteractionRequiredAuthError, InteractionStatus, type AccountInfo, type IPublicClientApplication,
} from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { CopilotChat, CopilotKitCoreErrorCode, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toolCallRenderer } from "./tool-call";

// The same id as the server's agent (lib/server/agent.ts).
const agentId = "chat";
const renderToolCalls = [toolCallRenderer];

// Called right after sign-in. The sign-in popup already asked consent for the gateway (extraScopesToConsent), or the
// gateway pre-authorizes this app, so the silent request normally succeeds. If Entra still wants an interaction, a
// second popup is tried; browsers may block it (popup_window_error), and "Renew sign-in" starts over from a click.
async function gatewayTokenAfterSignIn(instance: IPublicClientApplication, account: AccountInfo, gatewayScope: string) {
  const request = { account, scopes: [gatewayScope] };
  try {
    return (await instance.acquireTokenSilent(request)).accessToken;
  } catch (cause) {
    if (!(cause instanceof InteractionRequiredAuthError)) throw cause;
    return (await instance.acquireTokenPopup(request)).accessToken;
  }
}

export function SignedInChat({ scope, gatewayScope }: { scope: string; gatewayScope?: string }) {
  const { instance, accounts, inProgress } = useMsal();
  const account = accounts[0];
  const [token, setToken] = useState("");
  const [gatewayToken, setGatewayToken] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState(0);
  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const result = await instance.acquireTokenSilent({ account, scopes: [scope] });
      setToken(result.accessToken);
      if (gatewayScope) {
        setGatewayToken((await instance.acquireTokenSilent({ account, scopes: [gatewayScope] })).accessToken);
      }
      setError("");
    } catch (cause) {
      setToken("");
      setGatewayToken("");
      setError(cause instanceof InteractionRequiredAuthError
        ? "Your sign-in needs attention. Select Renew sign-in to continue."
        : "Could not renew sign-in. Sign out and try again.");
    }
  }, [account, instance, scope, gatewayScope]);
  useEffect(() => {
    if (!account) return;
    // MSAL renews the token before it expires; checking every minute keeps the chat's headers current.
    const start = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { window.clearTimeout(start); window.clearInterval(timer); };
  }, [account, refresh]);
  const headers = useMemo(() => {
    const authorization = { Authorization: `Bearer ${token}` };
    return gatewayToken ? { ...authorization, "x-gateway-token": gatewayToken } : authorization;
  }, [token, gatewayToken]);
  // The server refuses chat requests without the gateway token once it asks for one.
  const ready = Boolean(token) && (!gatewayScope || Boolean(gatewayToken));
  const signIn = () => {
    // The gateway's consent is asked in the same popup: a second popup, opened after this one closes, is no longer
    // tied to the user's click and browsers block it (popup_window_error).
    const extraScopesToConsent = gatewayScope ? [gatewayScope] : undefined;
    instance.loginPopup({ scopes: [scope], extraScopesToConsent }).then(async (result) => {
      instance.setActiveAccount(result.account);
      setToken(result.accessToken);
      if (gatewayScope) setGatewayToken(await gatewayTokenAfterSignIn(instance, result.account, gatewayScope));
      setError("");
    }).catch((cause: unknown) => setError(
      `Microsoft sign-in could not be completed${cause instanceof AuthError ? ` (${cause.errorCode})` : ""}.`,
    ));
  };
  if (!account) return <section>
    <h2>Sign in to use the chat</h2>
    <p>Access is limited to the configured users.</p>
    <button disabled={inProgress !== InteractionStatus.None} onClick={signIn}>Sign in with Microsoft</button>
    {error && <p role="alert">{error}</p>}
  </section>;
  return <>
    <section className="toolbar">
      <span>Signed in as <strong>{account.username}</strong></span>
      <span>
        <button onClick={() => setSession((value) => value + 1)}>New chat</button>{" "}
        <button onClick={() => {
          setToken("");
          setGatewayToken("");
          setSession((value) => value + 1);
          instance.logoutPopup({ account }).catch(() => setError("Sign-out could not be completed."));
        }}>Sign out</button>
      </span>
    </section>
    {error && <section role="alert">{error} <button onClick={signIn}>Renew sign-in</button></section>}
    {ready ? <section className="chat" aria-label="Chat">
      {/* A new key starts a new chat: history lives only in this page. */}
      <CopilotKitProvider key={`${account.homeAccountId}:${session}`}
        runtimeUrl="/api/copilotkit" agentId={agentId} headers={headers} renderToolCalls={renderToolCalls}>
        <CopilotChat agentId={agentId} onError={(event) => {
          // The agent already shows its own errors (RUN_ERROR) as a chat message.
          if ("code" in event && event.code !== CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT) {
            setError(`The chat failed: ${event.error.message}`);
          }
        }} />
      </CopilotKitProvider>
    </section> : !error && <p role="status">Acquiring your access tokens...</p>}
  </>;
}
