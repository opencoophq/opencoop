# Multi-Logon / Account Switching Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to stay logged into multiple OpenCoop accounts simultaneously and switch between them with one click — primarily useful for developers debugging coop admin vs shareholder views.

**Architecture:** Add a client-side session store (`sessions.ts`) backed by `localStorage` that persists multiple `{accessToken, refreshToken, user}` tuples. Every login path saves to this store. A new account-switcher UI in the dashboard sidebar lets users switch or add accounts without re-entering credentials. No backend changes required.

**Tech Stack:** TypeScript, React, localStorage, existing `api.ts` helper, Next.js App Router

---

## Chunk 1: Session Store Utility

### Task 1: Create `sessions.ts` session store

**Files:**
- Create: `apps/web/src/lib/sessions.ts`

**Storage schema** (all in `localStorage`):
```
savedSessions  → JSON: Session[]
activeSessionId → string (UUID)
```

```typescript
export interface Session {
  id: string;
  email: string;
  name?: string;
  role: string;
  accessToken: string;
  refreshToken?: string;
}
```

- [ ] **Step 1: Write `sessions.ts`**

```typescript
// apps/web/src/lib/sessions.ts

export interface Session {
  id: string;
  email: string;
  name?: string;
  role: string;
  accessToken: string;
  refreshToken?: string;
}

const SESSIONS_KEY = 'savedSessions';
const ACTIVE_KEY = 'activeSessionId';

export function getSessions(): Session[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function getActiveSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

/** Save or update a session for the given user. Returns the session id. */
export function saveSession(
  tokens: { accessToken: string; refreshToken?: string },
  user: { email: string; name?: string; role: string },
): string {
  const sessions = getSessions();
  const existing = sessions.find((s) => s.email === user.email);
  if (existing) {
    existing.accessToken = tokens.accessToken;
    if (tokens.refreshToken) existing.refreshToken = tokens.refreshToken;
    existing.name = user.name;
    existing.role = user.role;
    setSessions(sessions);
    return existing.id;
  }
  const id = crypto.randomUUID();
  sessions.push({ id, ...user, ...tokens });
  setSessions(sessions);
  return id;
}

/** Update access token for the active session (after token refresh). */
export function updateActiveSessionToken(accessToken: string) {
  const id = getActiveSessionId();
  if (!id) return;
  const sessions = getSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.accessToken = accessToken;
    setSessions(sessions);
  }
}

/** Switch localStorage to the given session and reload. */
export function switchSession(sessionId: string) {
  const sessions = getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return;
  localStorage.setItem('accessToken', session.accessToken);
  if (session.refreshToken) {
    localStorage.setItem('refreshToken', session.refreshToken);
  } else {
    localStorage.removeItem('refreshToken');
  }
  localStorage.setItem(
    'user',
    JSON.stringify({ email: session.email, name: session.name, role: session.role }),
  );
  localStorage.setItem(ACTIVE_KEY, sessionId);
  window.location.href = '/dashboard';
}

/** Remove a session. If it was active and others exist, switch to first available. */
export function removeSession(sessionId: string) {
  let sessions = getSessions();
  sessions = sessions.filter((s) => s.id !== sessionId);
  setSessions(sessions);
  const activeId = getActiveSessionId();
  if (activeId === sessionId) {
    if (sessions.length > 0) {
      switchSession(sessions[0].id);
    } else {
      clearAllSessions();
      window.location.href = '/login';
    }
  }
}

export function clearAllSessions() {
  localStorage.removeItem(SESSIONS_KEY);
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/sessions.ts
git commit -m "feat(auth): add multi-session store utility

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Chunk 2: Wire Session Store Into Auth Flows

### Task 2: Update `api.ts` to sync session store

**Files:**
- Modify: `apps/web/src/lib/api.ts`

Two changes:
1. After a successful token refresh, call `updateActiveSessionToken()` to keep the sessions store in sync.
2. `clearAuthAndRedirect` calls `clearAllSessions()` instead of three individual `removeItem` calls.

- [ ] **Step 1: Modify `tryRefreshToken` in `api.ts`**

After `localStorage.setItem('accessToken', data.accessToken)`, add:
```typescript
import { updateActiveSessionToken, clearAllSessions } from './sessions';
// ...
localStorage.setItem('accessToken', data.accessToken);
updateActiveSessionToken(data.accessToken);  // keep session store in sync
```

- [ ] **Step 2: Replace `clearAuthAndRedirect` body**

```typescript
function clearAuthAndRedirect() {
  clearAllSessions();
  window.location.href = '/login';
}
```

Remove the three manual `removeItem` calls.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(auth): sync session store on token refresh and logout

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

### Task 3: Update all login entry points to call `saveSession`

**Files to modify** (all share the same pattern — add 2 lines after each set of `localStorage.setItem` calls):
- `apps/web/src/components/auth/email-first-login.tsx` — password login, MFA success, passkey success
- `apps/web/src/app/[locale]/(auth)/magic-link/page.tsx` — magic link verification (2 places)
- `apps/web/src/app/[locale]/(auth)/oauth-callback/page.tsx` — OAuth callback (2 places)
- `apps/web/src/app/[locale]/(auth)/register/page.tsx` — new account registration
- `apps/web/src/app/[locale]/onboarding/page.tsx` — onboarding completion

**Pattern to apply everywhere:**

Before:
```typescript
localStorage.setItem('accessToken', result.accessToken);
localStorage.setItem('refreshToken', result.refreshToken);
localStorage.setItem('user', JSON.stringify(result.user));
```

After:
```typescript
import { saveSession } from '@/lib/sessions';
// ...
localStorage.setItem('accessToken', result.accessToken);
localStorage.setItem('refreshToken', result.refreshToken);
localStorage.setItem('user', JSON.stringify(result.user));
const sessionId = saveSession(
  { accessToken: result.accessToken, refreshToken: result.refreshToken },
  result.user,
);
localStorage.setItem('activeSessionId', sessionId);
```

> Note: `invite/[token]/page.tsx` only gets `accessToken` (no `refreshToken`, no `user`) — skip that file.
> Note: `dashboard/settings/page.tsx` only updates the `user` display name — no token change, skip it.

- [ ] **Step 1: Update `email-first-login.tsx`** (3 call sites: `onPasswordSubmit`, `PasskeyLoginButton.onSuccess`, `MfaVerifyStep.onSuccess`)

- [ ] **Step 2: Update `magic-link/page.tsx`** (2 call sites: lines ~95 and ~185)

- [ ] **Step 3: Update `oauth-callback/page.tsx`** (2 call sites: lines ~30 and ~56)

- [ ] **Step 4: Update `register/page.tsx`** (1 call site: line ~61)

- [ ] **Step 5: Update `onboarding/page.tsx`** (1 call site: line ~124)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/auth/email-first-login.tsx
git add "apps/web/src/app/[locale]/(auth)/magic-link/page.tsx"
git add "apps/web/src/app/[locale]/(auth)/oauth-callback/page.tsx"
git add "apps/web/src/app/[locale]/(auth)/register/page.tsx"
git add "apps/web/src/app/[locale]/onboarding/page.tsx"
git commit -m "feat(auth): save all login paths to multi-session store

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Chunk 3: "Add Account" Login Flow

### Task 4: Support `?addAccount=true` on login page

**Files:**
- Modify: `apps/web/src/app/[locale]/(auth)/login/page.tsx`

Currently, the login page redirects to `/dashboard` if `accessToken` exists. With `?addAccount=true`, it must show the login form even when already logged in.

- [ ] **Step 1: Update `login/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addAccount = searchParams.get('addAccount') === 'true';
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!addAccount && localStorage.getItem('accessToken')) {
      router.replace('/dashboard');
    } else {
      setReady(true);
    }
  }, [router, addAccount]);

  if (!ready) return null;

  return <EmailFirstLogin addAccount={addAccount} />;
}
```

- [ ] **Step 2: Accept `addAccount` prop in `EmailFirstLogin`**

In `email-first-login.tsx`, add `addAccount?: boolean` to `EmailFirstLoginProps`. After successful login when `addAccount` is `true`, redirect to `/dashboard` normally — the session store already saves the new session. The sidebar will show the account switcher.

```typescript
interface EmailFirstLoginProps {
  coop?: CoopBranding;
  onLoginSuccess?: () => void;
  addAccount?: boolean;  // new
}
```

No behavior change needed inside — the `saveSession` call from Task 3 already handles saving. The redirect to `/dashboard` is the same.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/[locale]/(auth)/login/page.tsx"
git add apps/web/src/components/auth/email-first-login.tsx
git commit -m "feat(auth): support addAccount flow on login page

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Chunk 4: Account Switcher UI in Dashboard Sidebar

### Task 5: Add account switcher to sidebar

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx`

Replace the current static user section at the bottom of the sidebar with an interactive account switcher. Show all saved sessions; clicking one switches to it. Show "Add account" link.

- [ ] **Step 1: Import session utilities in layout**

```typescript
import { getSessions, getActiveSessionId, switchSession, removeSession } from '@/lib/sessions';
```

- [ ] **Step 2: Add state for saved sessions**

```typescript
const [sessions, setSessions] = useState<import('@/lib/sessions').Session[]>([]);
const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
```

In the existing `useEffect` (that reads from localStorage on mount), add:
```typescript
setSessions(getSessions());
setActiveSessionId(getActiveSessionId());
```

- [ ] **Step 3: Replace the user section in the sidebar**

Current user section (lines ~351–370 in `layout.tsx`):
```tsx
<div className="p-3 border-t">
  <div className="flex items-center justify-between">
    <Link href="/dashboard/settings" ...>
      {user.name ? ...}
    </Link>
    <Button variant="ghost" size="icon" onClick={handleLogout}>
      <LogOut className="h-4 w-4" />
    </Button>
  </div>
</div>
```

Replace with:
```tsx
<div className="p-3 border-t">
  {/* Current user */}
  <div className="flex items-center justify-between mb-2">
    <Link href="/dashboard/settings" className="text-sm truncate min-w-0 hover:opacity-80">
      {user.name ? (
        <>
          <p className="font-medium truncate">{user.name}</p>
          <p className="text-muted-foreground text-xs truncate">{user.email}</p>
        </>
      ) : (
        <>
          <p className="font-medium truncate">{user.email}</p>
          <p className="text-muted-foreground text-xs">{t(`system.users.roles.${user.role}`)}</p>
        </>
      )}
    </Link>
    <Button variant="ghost" size="icon" onClick={handleLogout}>
      <LogOut className="h-4 w-4" />
    </Button>
  </div>

  {/* Other saved sessions */}
  {sessions.filter((s) => s.id !== activeSessionId).map((s) => (
    <button
      key={s.id}
      onClick={() => switchSession(s.id)}
      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
    >
      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium flex-shrink-0">
        {(s.name || s.email).charAt(0).toUpperCase()}
      </div>
      <span className="truncate">{s.name || s.email}</span>
    </button>
  ))}

  {/* Add account */}
  <Link
    href="/login?addAccount=true"
    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-accent flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
  >
    <div className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/50 flex items-center justify-center flex-shrink-0">
      <span className="text-[12px] leading-none">+</span>
    </div>
    <span>{t('auth.addAccount')}</span>
  </Link>
</div>
```

- [ ] **Step 4: Add `auth.addAccount` translation key**

In `apps/web/messages/en.json`, `nl.json`, `fr.json`, `de.json`:

```json
// en.json
"auth": {
  "addAccount": "Add account",
  ...
}
// nl.json: "Account toevoegen"
// fr.json: "Ajouter un compte"
// de.json: "Konto hinzufügen"
```

- [ ] **Step 5: Update `handleLogout` to use session store**

Replace:
```typescript
const handleLogout = () => {
  api('/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  router.push('/login');
};
```

With:
```typescript
import { removeSession, getActiveSessionId } from '@/lib/sessions';

const handleLogout = () => {
  api('/auth/logout', { method: 'POST' }).catch(() => {});
  const id = getActiveSessionId();
  if (id) {
    removeSession(id); // handles redirect internally (switch to next or go to /login)
  } else {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.push('/login');
  }
};
```

> Note: `removeSession` calls `window.location.href` internally when switching or logging out, so React router is not needed.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/[locale]/dashboard/layout.tsx"
git add apps/web/messages/en.json apps/web/messages/nl.json apps/web/messages/fr.json apps/web/messages/de.json
git commit -m "feat(auth): add account switcher UI to dashboard sidebar

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
```

---

## Chunk 5: Manual QA Checklist

No automated tests are needed for this feature (it's purely localStorage/UI manipulation with no API contract changes).

### Task 6: Manual verification

- [ ] **Step 1: Log in as coop admin** (`admin@zonnecooperatie.be` / `demo1234` on acc). Verify session is saved in `localStorage.savedSessions`.

- [ ] **Step 2: Click "Add account"** in sidebar. Verify login page shows even though already logged in.

- [ ] **Step 3: Log in as shareholder** (`jan.peeters@email.be` / `demo1234`). Verify redirected to dashboard as shareholder. Verify `savedSessions` now has 2 entries.

- [ ] **Step 4: Click the admin session** in the sidebar switcher. Verify instant switch back to admin view without re-entering credentials.

- [ ] **Step 5: Click logout** on admin account. Verify it switches back to the shareholder session (not `/login`).

- [ ] **Step 6: Logout from last session.** Verify redirect to `/login`.

- [ ] **Step 7: Verify token refresh** still works — open DevTools → Application → localStorage → delete `savedSessions`. Confirm normal auth still works without the session store.

---

## Notes & Trade-offs

- **Security**: Storing multiple refresh tokens in localStorage is acceptable here since OpenCoop already uses localStorage-only auth. For production hardening, consider `httpOnly` cookies, but that requires backend changes outside this scope.
- **Token expiry on switch**: If a saved session's `accessToken` has expired, `api.ts` will attempt refresh using the stored `refreshToken`. If that also fails, the 401 handler redirects to `/login`. This is the correct fallback.
- **Passkey / OAuth logins**: These already call `saveSession` after Task 3. Works transparently.
- **Multiple tabs**: Tabs share localStorage, so switching in one tab will affect others on the next API call. This is acceptable for a dev-debugging use case.
- **`invite/[token]/page.tsx`**: This only receives `accessToken` without `user` data at token-write time, so it can't be saved to the session store cleanly. Left out of scope.
