export interface Session {
  id: string;
  email: string;
  name?: string;
  role: string;
  accessToken: string;
  refreshToken?: string;
  user: Record<string, unknown>;
}

function generateSessionId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getSessions(): Session[] {
  try {
    const raw = localStorage.getItem('savedSessions');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setSessions(sessions: Session[]): void {
  localStorage.setItem('savedSessions', JSON.stringify(sessions));
}

export function saveSession(params: {
  accessToken: string;
  refreshToken?: string | null;
  user: Record<string, unknown>;
}): string {
  const { accessToken, refreshToken, user } = params;
  const sessions = getSessions();

  // Reuse existing session for this email, or create new one
  const existingIndex = sessions.findIndex((s) => s.email === String(user.email ?? ''));
  const sessionId = existingIndex >= 0 ? sessions[existingIndex].id : generateSessionId();

  const session: Session = {
    id: sessionId,
    email: String(user.email ?? ''),
    name: user.name ? String(user.name) : undefined,
    role: String(user.role ?? ''),
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    user,
  };

  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.push(session);
  }

  setSessions(sessions);
  localStorage.setItem('activeSessionId', sessionId);
  return sessionId;
}

export function switchSession(sessionId: string): boolean {
  const sessions = getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return false;

  localStorage.setItem('accessToken', session.accessToken);
  if (session.refreshToken) {
    localStorage.setItem('refreshToken', session.refreshToken);
  } else {
    localStorage.removeItem('refreshToken');
  }
  localStorage.setItem('user', JSON.stringify(session.user));
  localStorage.setItem('activeSessionId', sessionId);
  return true;
}

export function removeSession(sessionId: string): Session | null {
  const sessions = getSessions();
  const index = sessions.findIndex((s) => s.id === sessionId);
  if (index < 0) return null;

  const removed = sessions[index];
  sessions.splice(index, 1);
  setSessions(sessions);
  return removed;
}

export function getAllSessions(): Session[] {
  return getSessions();
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem('activeSessionId');
}

export function clearAllSessions(): void {
  localStorage.removeItem('savedSessions');
  localStorage.removeItem('activeSessionId');
}

export function updateActiveSessionToken(accessToken: string): void {
  const activeId = getActiveSessionId();
  if (!activeId) return;

  const sessions = getSessions();
  const index = sessions.findIndex((s) => s.id === activeId);
  if (index >= 0) {
    sessions[index].accessToken = accessToken;
    setSessions(sessions);
  }
}
