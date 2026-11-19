import { createHash } from 'crypto';
import { scrubFeedbackText } from './feedback-scrubber';

export function normalizeFeedbackTitle(title: string): string {
  return scrubFeedbackText(title).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Same kind, tool (any case) and normalized, scrubbed title → same fingerprint → same GitHub
 * issue.
 */
export function feedbackFingerprint(
  kind: string,
  toolName: string | undefined,
  title: string,
): string {
  return createHash('sha256')
    .update(`${kind}|${toolName?.toLowerCase() ?? ''}|${normalizeFeedbackTitle(title)}`)
    .digest('hex')
    .slice(0, 12);
}

export function feedbackFingerprintMarker(fingerprint: string): string {
  return `<!-- mcp-feedback-fingerprint: ${fingerprint} -->`;
}
