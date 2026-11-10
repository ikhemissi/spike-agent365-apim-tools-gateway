"use client";
// The signed-in part of the page: keeps fresh access tokens and shows the CopilotKit chat with the server's agent.
// Next to the sign-in token, the server may need more tokens of the same user (extraTokens), each in its own header:
// for the gateway (LiteLLM or API Management) in x-gateway-token, and in Foundry mode for Foundry in x-foundry-token.

import {
  AuthError, InteractionRequiredAuthError, InteractionStatus, type AccountInfo, type IPublicClientApplication,
} from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { CopilotChat, CopilotKitCoreErrorCode, CopilotKitProvider } from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toolCallRenderer } from "./tool-call";

// The same id as the server's agent (lib/server/agent.ts).
const agentId = "chat";
const renderToolCalls = [toolCallRenderer];

// A token the server needs next to the sign-in token: the header it goes in, and the scope it is for.
export interface ExtraToken {
  header: string;
  scope: string;
}

// Called right after sign-in. The sign-in popup already asked consent for these scopes (extraScopesToConsent), or their
// API pre-authorizes this app, so the silent request normally succeeds. If Entra still wants an interaction, a second
// popup is tried; browsers may block it (popup_window_error), and "Renew sign-in" starts over from a click.
async function tokenAfterSignIn(instance: IPublicClientApplication, account: AccountInfo, scope: string) {
  const request = { account, scopes: [scope] };
  try {
    return (await instance.acquireTokenSilent(request)).accessToken;
  } catch (cause) {
    if (!(cause instanceof InteractionRequiredAuthError)) throw cause;
    return (await instance.acquireTokenPopup(request)).accessToken;
  }
}

export function SignedInChat({ scope, extraTokens }: { scope: string; extraTokens: ExtraToken[] }) {
  const { instance, accounts, inProgress } = useMsal();
  const account = accounts[0];
  const [token, setToken] = useState("");
  // The extra tokens, by header.
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [session, setSession] = useState(0);
  // The chat's thread id, new with each chat; in Foundry mode the server keeps the agent's session per thread.
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const startNewChat = () => {
    setThreadId(crypto.randomUUID());
    setSession((value) => value + 1);
  };
  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const result = await instance.acquireTokenSilent({ account, scopes: [scope] });
      setToken(result.accessToken);
      const renewed: Record<string, string> = {};
      for (const { header, scope: extraScope } of extraTokens) {
        renewed[header] = (await instance.acquireTokenSilent({ account, scopes: [extraScope] })).accessToken;
      }
      setExtra(renewed);
      setError("");
    } catch (cause) {
      setToken("");
      setExtra({});
      setError(cause instanceof InteractionRequiredAuthError
        ? "Your sign-in needs attention. Select Renew sign-in to continue."
        : "Could not renew sign-in. Sign out and try again.");
    }
  }, [account, instance, scope, extraTokens]);
  useEffect(() => {
    if (!account) return;
    // MSAL renews the token before it expires; checking every minute keeps the chat's headers current.
    const start = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { window.clearTimeout(start); window.clearInterval(timer); };
  }, [account, refresh]);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}`, ...extra }), [token, extra]);
  // The server refuses chat requests without the extra tokens it asks for.
  const ready = Boolean(token) && extraTokens.every(({ header }) => Boolean(extra[header]));
  // Foundry mode: as soon as a chat opens, ask the server to start the agent's session, so that its container is
  // running by the first message. Once per thread; if it fails, the first message starts one.
  const startsSessions = extraTokens.some(({ header }) => header === "x-foundry-token");
  const sessionStarted = useRef("");
  useEffect(() => {
    if (!ready || !startsSessions || sessionStarted.current === threadId) return;
    sessionStarted.current = threadId;
    void fetch("/api/session", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    }).catch(() => undefined);
  }, [ready, startsSessions, threadId, headers]);
  const signIn = () => {
    // The extra scopes' consent is asked in the same popup: a second popup, opened after this one closes, is no longer
    // tied to the user's click and browsers block it (popup_window_error).
    const extraScopesToConsent = extraTokens.length ? extraTokens.map((extraToken) => extraToken.scope) : undefined;
    instance.loginPopup({ scopes: [scope], extraScopesToConsent }).then(async (result) => {
      instance.setActiveAccount(result.account);
      setToken(result.accessToken);
      const acquired: Record<string, string> = {};
      for (const { header, scope: extraScope } of extraTokens) {
        acquired[header] = await tokenAfterSignIn(instance, result.account, extraScope);
      }
      setExtra(acquired);
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
        <button onClick={startNewChat}>New chat</button>{" "}
        <button onClick={() => {
          setToken("");
          setExtra({});
          startNewChat();
          instance.logoutPopup({ account }).catch(() => setError("Sign-out could not be completed."));
        }}>Sign out</button>
      </span>
    </section>
    {error && <section role="alert">{error} <button onClick={signIn}>Renew sign-in</button></section>}
    {ready ? <section className="chat" aria-label="Chat">
      {/* A new key starts a new chat: history lives only in this page. */}
      <CopilotKitProvider key={`${account.homeAccountId}:${session}`}
        runtimeUrl="/api/copilotkit" agentId={agentId} headers={headers} renderToolCalls={renderToolCalls}>
        <CopilotChat agentId={agentId} threadId={threadId} onError={(event) => {
          // The agent already shows its own errors (RUN_ERROR) as a chat message.
          if ("code" in event && event.code !== CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT) {
            setError(`The chat failed: ${event.error.message}`);
          }
        }} />
      </CopilotKitProvider>
    </section> : !error && <p role="status">Acquiring your access tokens...</p>}
  </>;
}
