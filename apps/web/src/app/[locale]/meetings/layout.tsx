import type { ReactNode } from 'react';

/**
 * Public meetings layout — pass-through, no auth, no dashboard chrome.
 * Used by /meetings/rsvp/[token] (magic-link RSVP) and /meetings/kiosk/[token]
 * (kiosk self-check-in). Both routes authenticate via tokens carried in the URL,
 * not via JWT.
 */
export default function MeetingsLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-muted/30">{children}</div>;
}
