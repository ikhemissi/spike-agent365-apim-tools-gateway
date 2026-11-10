// Foundry mode: the hosted agent's session for each chat thread, so that the thread's messages find the agent's
// container running (a new session takes about 5-8 s to start). The page asks for a session as soon as a chat opens
// (/api/session); a message that arrives while it is starting waits for it rather than starting a second one.
// Kept in this server's memory, by user and thread: a user never reuses another user's session. A lost entry (a
// restart, an old thread) only costs a new session. The agent keeps no user data in its session: the user's tokens
// live for one request.
const maxSessions = 1_000;
// Foundry suspends an idle session after 15 minutes by default; a later request would start it cold anyway.
const maxIdleMs = 15 * 60_000;

interface RememberedSession {
  id: string;
  lastUsed: number;
}

const sessions = new Map<string, RememberedSession>();
const starting = new Map<string, Promise<string | undefined>>();

export function sessionKey(userId: string, threadId: string): string {
  return `${userId}:${threadId}`;
}

export function rememberedSession(key: string, now = Date.now()): string | undefined {
  const session = sessions.get(key);
  if (!session || now - session.lastUsed > maxIdleMs) {
    sessions.delete(key);
    return undefined;
  }
  return session.id;
}

export function rememberSession(key: string, id: string, now = Date.now()): void {
  // A Map keeps insertion order: re-inserting moves the key last, so the first key is the least recently used.
  sessions.delete(key);
  sessions.set(key, { id, lastUsed: now });
  if (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value!);
}

// Starts a session for a thread, once: a second call while it starts, or once it is remembered, does nothing.
export function startSession(key: string, create: () => Promise<string>): Promise<string | undefined> {
  const remembered = rememberedSession(key);
  if (remembered) return Promise.resolve(remembered);
  let pending = starting.get(key);
  if (!pending) {
    pending = create().then((id) => {
      rememberSession(key, id);
      return id;
    }, () => undefined).finally(() => starting.delete(key));
    starting.set(key, pending);
  }
  return pending;
}

// The session a thread's message should use: the remembered one, or the one still starting (awaited), or none.
export async function sessionFor(key: string): Promise<string | undefined> {
  return rememberedSession(key) ?? await starting.get(key);
}

export function forgetAllSessions(): void {
  sessions.clear();
  starting.clear();
}
