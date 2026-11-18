/**
 * Removes personal data and secrets from free text an agent sends to `submit_feedback`,
 * before that text goes to a public-ish GitHub issue. Each hit becomes `[REDACTED:<type>]`.
 *
 * The order matters: secrets first (a token can look like anything), then names and
 * addresses in structured payloads, IBANs, national register numbers, display names before
 * emails, emails, phones, and last the long opaque blobs. Scrubbing already scrubbed text changes nothing.
 */

type RedactionType = 'secret' | 'name' | 'address' | 'iban' | 'national_id' | 'email' | 'phone';

const redacted = (type: RedactionType): string => `[REDACTED:${type}]`;
const ALREADY_REDACTED = /^\[REDACTED:[a-z_]+\]$/;

// A secret key ends in one of these words, after any identifier prefix:
// JWT_SECRET, x-api-key, DB_PASSWORD, stripeSecretKey, csrf_token.
const SECRET_KEY =
  '[A-Za-z0-9_-]*?(?:password|passwd|pwd|secret(?:[_-]?key)?|token|api[_-]?key|' +
  'private[_-]?key|authorization)';

// Common words in prose ("Tool name: x", "member: since 2020", "send to: admin"). Redacted
// only when the key or the value is quoted, as in JSON or a JS object, or when the unquoted
// value starts with two capitalised words ("name: Jan Peeters").
const GENERIC_NAME_KEYS = new Set([
  'name',
  'member',
  'customer',
  'holder',
  'from',
  'to',
  'user',
  'owner',
  'contact',
  'partner',
  'shareholder',
  'author',
]);

const NAME_KEYS = [
  ...GENERIC_NAME_KEYS,
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'fullName',
  'full_name',
  'displayName',
  'contactName',
  'shareholderName',
  'customerName',
  'memberName',
  'accountHolder',
  'account_holder',
  'counterpartyName',
  'beneficiaryName',
  'signedByName',
  'payee',
  'sender',
  'recipient',
  'organizer',
  'attendee',
  'assignee',
  'created_by',
  'createdBy',
  'beneficiary',
  'legalRepresentative',
  'legal_representative',
  'companyName',
  'company_name',
];

const ADDRESS_KEYS = [
  'address',
  'street',
  'adres',
  'straat',
  'streetAddress',
  'street_address',
  'addressLine1',
  'address_line_1',
];

// A personal name: capitalised words, with lowercase particles allowed between them.
const PARTICLE = '(?:van|de|der|den|le|la|du|von|vande)';
const NAME_WORD = "\\p{Lu}[\\p{L}'’-]*";
// Two capitalised words at the start of a value: "Jan Peeters", "Marie Van den Berg".
const STARTS_WITH_FULL_NAME = new RegExp(
  `^${NAME_WORD}[ \\t]+(?:${PARTICLE}[ \\t]+){0,3}\\p{Lu}`,
  'u',
);
// Value that is a date or time ("2026-10-01", "01/10/2026 10:00", "10:30").
const DATE_OR_TIME = /^(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}:\d{2})/;

function keyAlternation(keys: string[]): string {
  return [...keys].sort((a, b) => b.length - a.length).join('|');
}

// Key (optionally quoted, not part of a longer identifier), separator, then the value.
// Groups: 1 = quote around the key, 2 = key, 3 = separator, 4 = value.
function keyValuePattern(keyPattern: string, unquotedValue: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9_-])(["']?)(${keyPattern})\\1(\\s*[:=]\\s*)` +
      `("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|${unquotedValue})`,
    'gi',
  );
}

const SECRET_KV = keyValuePattern(SECRET_KEY, `[^\\s,;&}\\]"'{\\[][^\\s,;&}\\]"']*`);
const NAME_KV = keyValuePattern(keyAlternation(NAME_KEYS), `[^\\s,}\\]&{\\["'][^,}\\]&\\n]*`);
// An unquoted address runs to the end of the line: "Kerkstraat 1, 2000 Antwerpen".
const ADDRESS_KV = keyValuePattern(keyAlternation(ADDRESS_KEYS), `[^\\s{\\["'][^\\n]*`);

// "Jan Peeters <jan@x.be>" or "\"Jan Peeters\" <jan@x.be>": the name before an email address.
const DISPLAY_NAME = new RegExp(
  `(?:"[^"\\n<>]{1,100}"|(?<!\\p{L})${NAME_WORD}(?:[ \\t]+(?:${PARTICLE}[ \\t]+){0,3}${NAME_WORD}){0,5})` +
    `[ \\t]*<(?=[^<>\\s@]{1,64}@[^<>\\s@]{1,190}>)`,
  'gu',
);

// [id, "Jan Peeters"]: a number or a quoted token, then a quoted name of 1–5 words.
const NAME_TUPLE = new RegExp(
  `(\\[\\s*(?:-?\\d{1,20}(?:\\.\\d{1,10})?|"[^"\\s]{1,100}"|'[^'\\s]{1,100}')\\s*,\\s*)` +
    `(["'])(${NAME_WORD}(?: (?:${NAME_WORD}|${PARTICLE})){0,4})\\2(\\s*\\])`,
  'gu',
);

const BEARER = /\b(Bearer)(\s+)[A-Za-z0-9._~+/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const GITHUB_TOKEN = /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;
const SK_KEY = /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g;
const AWS_KEY_ID = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;
const OPENCOOP_KEY = /\boc_[A-Za-z0-9_-]{16,}/g;
const LONG_HEX = /(?<![A-Za-z0-9])[A-Fa-f0-9]{32,}(?![A-Za-z0-9])/g;
const LONG_BASE64 = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}/g;

// Countries in the SWIFT IBAN registry. Only these count, so ids like cuids stay readable.
const IBAN_COUNTRIES = new Set(
  (
    'AD AE AL AT AZ BA BE BG BH BI BR BY CH CR CY CZ DE DJ DK DO EE EG ES FI FK FO FR GB GE GI ' +
    'GL GR GT HN HR HU IE IL IQ IS IT JO KW KZ LB LC LI LT LU LV LY MC MD ME MK MN MR MT MU NI ' +
    'NL NO OM PK PL PS PT QA RO RS RU SA SC SD SE SI SK SM SO ST SV TL TN TR UA VA VG XK YE'
  ).split(' '),
);
// Country, check digits, then groups of 4 split by an optional space, dot or dash. After the
// first group each group holds a digit, so a word after the IBAN is not swallowed.
const IBAN_GROUPED =
  /\b[A-Za-z]{2}\d{2}(?:[ .-]?[A-Za-z0-9]{4})(?:[ .-]?(?=[A-Za-z]{0,3}\d)[A-Za-z0-9]{4}){1,6}(?:[ .-]?\d{1,3})?\b/g;
const IBAN_COMPACT = /\b[A-Za-z]{2}\d{2}[A-Za-z0-9]{11,30}\b/g;

// YY.MM.DD-XXX.CC and its variants: dots, dashes, spaces or nothing between the parts.
const NATIONAL_ID = /(?<![\w.+-])\d{2}(\.?)\d{2}\1\d{2}[-. ]?\d{3}[-. ]?\d{2}(?![\w.-]?\d)/g;

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// +<country> then groups of digits, optionally "(0)", separated by one space, dot, slash or dash.
const PHONE_INTERNATIONAL = /(?<![\w+])\+\d{1,3}(?:[ ./-]?(?:\(\d{1,4}\)|\d{1,4})){1,8}/g;
// 00 + country code, then groups of digits: 0032 475 12 34 56, 0032475123456.
const PHONE_DOUBLE_ZERO = /(?<![\w+.,/:-])00\d(?:[ ./-]?\d{1,4}){1,8}(?![\w.,/:-]?\d)/g;
// Belgian area code in brackets: (02) 123 45 67, (0475) 12 34 56, (09)/123.45.67.
const PHONE_BRACKETED =
  /(?<![\w(])\(0\d{1,3}\)[ ./-]?\d{2,3}(?:[ ./-]?\d{2,3}){1,3}(?![\w.,/:-]?\d)/g;
// Belgian national format: 0 + zone/mobile prefix, then groups of 2–3 digits.
const PHONE_BELGIAN = /(?<![\w+.,/:-])0\d{1,3}(?:[ ./-]?\d{2,3}){2,4}(?![\w.,/:-]?\d)/g;

const MENTION = /(^|[^A-Za-z0-9_.@/`-])@([A-Za-z0-9][A-Za-z0-9-]*)/g;
const HTML_COMMENT_OPEN = /<!--/g;

function countDigits(value: string): number {
  return value.replace(/\D/g, '').length;
}

function redactValue(type: RedactionType, keepScalarTypes: boolean) {
  return (match: string, quote: string, key: string, separator: string, value: string): string => {
    const first = value[0];
    const quoted = first === '"' || first === "'";
    const inner = quoted ? value.slice(1, -1) : value.trimEnd();
    if (inner === '' || ALREADY_REDACTED.test(inner)) return match;
    if (type === 'secret' && /^bearer$/i.test(inner)) return match;
    if (
      keepScalarTypes &&
      !quoted &&
      /^(?:null|true|false|undefined|-?\d+(?:\.\d+)?)$/i.test(inner)
    ) {
      return match;
    }
    // An unquoted address runs to the end of the line, so `"address": null}` holds more than
    // the literal. A leading number stays part of the address ("12, rue de la Paix").
    if (type === 'address' && !quoted && /^(?:null|true|false|undefined)\s*[,}\]]/i.test(inner)) {
      return match;
    }
    if (type === 'name') {
      // Dates, times, and single-token ids such as "clx1abc2def" or "usr_42" are not names.
      if (DATE_OR_TIME.test(inner) || (!/\s/.test(inner) && /[\d_]/.test(inner))) return match;
      if (
        !quote &&
        !quoted &&
        GENERIC_NAME_KEYS.has(key.toLowerCase()) &&
        !STARTS_WITH_FULL_NAME.test(inner)
      ) {
        return match;
      }
    }
    const trailing = quoted ? '' : value.slice(inner.length);
    const replacement = quoted ? `${first}${redacted(type)}${first}` : redacted(type);
    return `${quote}${key}${quote}${separator}${replacement}${trailing}`;
  };
}

function scrubSecrets(text: string): string {
  return text
    .replace(BEARER, (_m, word: string, space: string) => `${word}${space}${redacted('secret')}`)
    .replace(JWT, redacted('secret'))
    .replace(GITHUB_TOKEN, redacted('secret'))
    .replace(SK_KEY, redacted('secret'))
    .replace(AWS_KEY_ID, redacted('secret'))
    .replace(OPENCOOP_KEY, redacted('secret'))
    .replace(SECRET_KV, redactValue('secret', false));
}

function scrubIbans(text: string): string {
  const replaceIban = (match: string): string =>
    IBAN_COUNTRIES.has(match.slice(0, 2).toUpperCase()) &&
    countDigits(match) >= 10 &&
    match.replace(/[ .-]/g, '').length <= 34
      ? redacted('iban')
      : match;
  return text.replace(IBAN_GROUPED, replaceIban).replace(IBAN_COMPACT, replaceIban);
}

function scrubNationalIds(text: string): string {
  return text.replace(NATIONAL_ID, redacted('national_id'));
}

function scrubPhones(text: string): string {
  return text
    .replace(PHONE_BRACKETED, (match) => {
      const digits = countDigits(match);
      return digits >= 9 && digits <= 10 ? redacted('phone') : match;
    })
    .replace(PHONE_INTERNATIONAL, (match) => (countDigits(match) >= 8 ? redacted('phone') : match))
    .replace(PHONE_DOUBLE_ZERO, (match) => {
      const digits = countDigits(match);
      return digits >= 10 && digits <= 15 ? redacted('phone') : match;
    })
    .replace(PHONE_BELGIAN, (match) => {
      const digits = countDigits(match);
      return digits >= 9 && digits <= 10 ? redacted('phone') : match;
    });
}

function scrubLongBlobs(text: string): string {
  return text
    .replace(LONG_HEX, redacted('secret'))
    .replace(LONG_BASE64, (match) =>
      /\d/.test(match) && /[A-Z]/.test(match) && /[a-z]/.test(match) ? redacted('secret') : match,
    );
}

function neutraliseMarkup(text: string): string {
  return text
    .replace(MENTION, (_m, before: string, handle: string) => `${before}@\u200b${handle}`)
    .replace(HTML_COMMENT_OPEN, '&lt;!--');
}

export function scrubFeedbackText(text: string): string {
  let result = scrubSecrets(text);
  result = result.replace(NAME_KV, redactValue('name', true));
  result = result.replace(
    NAME_TUPLE,
    (_m, head: string, quote: string, _name: string, tail: string) =>
      `${head}${quote}${redacted('name')}${quote}${tail}`,
  );
  result = result.replace(ADDRESS_KV, redactValue('address', true));
  result = scrubIbans(result);
  result = scrubNationalIds(result);
  result = result.replace(DISPLAY_NAME, `${redacted('name')} <`);
  result = result.replace(EMAIL, redacted('email'));
  result = scrubPhones(result);
  result = scrubLongBlobs(result);
  return neutraliseMarkup(result);
}
