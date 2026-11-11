/**
 * Escape HTML-significant characters so user/coop-controlled free text can be
 * safely interpolated into email HTML without allowing markup/script injection
 * (audit Q5). Only use for plain-text values — never for trusted URLs, numbers,
 * system-generated codes, or intentionally pre-rendered HTML.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
