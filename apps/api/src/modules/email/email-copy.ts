/**
 * Locale copy loader for transactional email templates.
 *
 * The 4-language COPY for each template lives in the sibling `i18n/{lang}.json`
 * files, keyed by templateKey. The HTML STRUCTURE (and all security
 * HTML-escaping of user-controlled values) stays in `email.processor.ts`.
 *
 * Copy strings are static text with `{token}` placeholders. The processor
 * pre-computes each token's substitution value (already HTML-escaped where the
 * original inline copy escaped it) and passes them to `applyTokens`, which
 * performs a literal, non-recursive replacement. This reproduces the previous
 * template-literal interpolation byte-for-byte while keeping the editable copy
 * as data.
 */
import nl from './i18n/nl.json';
import en from './i18n/en.json';
import fr from './i18n/fr.json';
import de from './i18n/de.json';

type CopyBundle = Record<string, Record<string, string>>;

const bundles: Record<string, CopyBundle> = {
  nl: nl as CopyBundle,
  en: en as CopyBundle,
  fr: fr as CopyBundle,
  de: de as CopyBundle,
};

/**
 * Returns the copy object for a given templateKey in the requested language,
 * falling back to Dutch (`nl`) — mirroring the previous `t[lang] || t['nl']`.
 */
export function getCopy(templateKey: string, lang: string): Record<string, string> {
  const bundle = bundles[lang] || bundles['nl'];
  const fallback = bundles['nl'];
  return bundle[templateKey] || fallback[templateKey] || {};
}

/**
 * Literal `{token}` substitution. Each token is replaced with its provided
 * value exactly once-per-occurrence, non-recursively (a replacement value that
 * happens to contain `{token}` text is never re-scanned). Values must already
 * be HTML-escaped by the caller where the original copy escaped them.
 */
export function applyTokens(
  template: string,
  tokens: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : match,
  );
}

/**
 * Look up the full copy object for `(templateKey, lang)` (with `nl` fallback)
 * and token-substitute every field with the provided values. Returns a plain
 * object whose keys are the copy fields and whose values are the rendered
 * strings — a drop-in replacement for the previous inline `s` object.
 */
export function buildCopy(
  templateKey: string,
  lang: string,
  tokens: Record<string, string> = {},
): Record<string, string> {
  const copy = getCopy(templateKey, lang);
  const out: Record<string, string> = {};
  for (const key of Object.keys(copy)) {
    out[key] = applyTokens(copy[key], tokens);
  }
  return out;
}
