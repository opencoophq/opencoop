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

// Values under these keys are redacted unless they are clearly not a name (a MACHINE TOKEN,
// see isMachineToken). Over-redaction of prose such as "Tool name: List shareholders" is
// accepted: a missed name in a public issue costs more than a lost word.
const NAME_KEYS = [
  'name',
  'label',
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

// A date or time: "2026-10-01", "01/10/2026 10:00", "2026-10-01T10:00:00Z", "10:30".
const DATE_OR_TIME =
  /^(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)$/;
const SCALAR = /^(?:-?\d{1,20}(?:\.\d{1,20})?|true|false|null|undefined)$/i;
// A hyphenated capitalised word ("Marie-Claire", "Van-Damme") is a name, not an id.
const HYPHENATED_NAME = /^\p{Lu}\p{Ll}+(?:-\p{L}+){1,4}$/u;

/**
 * True when a value is clearly not a personal name: a date or time, a number or literal, or a
 * single word that holds a digit or one of _ . - : / ("usr_42", "clx1abc", "get_x"), is plain
 * lowercase ASCII ("error", "admin"), or is a 2-letter country code ("BE") or a currency
 * ("EUR"). "JAN" is not a code.
 */
export function isMachineToken(value: string): boolean {
  if (ALREADY_REDACTED.test(value) || DATE_OR_TIME.test(value) || SCALAR.test(value)) return true;
  if (value.length === 0 || value.length > 200 || /\s/.test(value)) return false;
  if (HYPHENATED_NAME.test(value)) return false;
  return (
    /[\d_.\-:/]/.test(value) ||
    /^[a-z]+$/.test(value) ||
    /^(?:[A-Z]{2}|EUR|USD|GBP|CHF)$/.test(value)
  );
}

/** Every key whose value is treated as a personal name. */
export const FEEDBACK_NAME_KEYS: readonly string[] = NAME_KEYS;

// Keys that only ever hold a name: no MACHINE TOKEN exception, only literals are kept.
const SPECIFIC_NAME_KEYS = new Set(
  NAME_KEYS.filter(
    (key) =>
      /name$|^accountholder$|^account_holder$|^legal_?representative$|^created_?by$/i.test(key) &&
      key !== 'name',
  ).map((key) => key.toLowerCase()),
);

/** Name keys whose value is redacted unless it is a literal (number, boolean, null, date). */
export const FEEDBACK_SPECIFIC_NAME_KEYS: readonly string[] = NAME_KEYS.filter((key) =>
  SPECIFIC_NAME_KEYS.has(key.toLowerCase()),
);

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
// An unquoted name runs to the end of the line or to } ] & ; |. A comma does not end it, so
// "Peeters, Jan" is redacted whole.
// A literal (number, true/false/null/undefined, ISO date) ends at a comma, so the next
// `"key": value` pair is still checked: `"name": null, "contact": Jan Peeters`.
const NAME_LITERAL =
  '(?:-?\\d{1,20}(?:\\.\\d{1,20})?|true|false|null|undefined|\\d{4}-\\d{2}-\\d{2})' +
  '(?=[ \\t]*(?:[,}\\]&;|\\n]|$))';
const NAME_KV = keyValuePattern(
  keyAlternation(NAME_KEYS),
  `${NAME_LITERAL}|[^\\s}\\]&;|{\\["'][^}\\]&;|\\n]*`,
);
// An unquoted address runs to the end of the line: "Kerkstraat 1, 2000 Antwerpen".
const ADDRESS_KV = keyValuePattern(keyAlternation(ADDRESS_KEYS), `[^\\s{\\["'][^\\n]*`);

// 1–6 words (any case, commas allowed) or a quoted string, right before <email> on one line:
// "jan peeters <x@y.be>", "Peeters, Jan <x@y.be>", "\"Jan Peeters\" <x@y.be>".
const DISPLAY_WORD = "[\\p{L}\\p{M}'’-]{1,40}";
const DISPLAY_NAME = new RegExp(
  `(?:"[^"\\n<>]{1,100}"|(?<![\\p{L}\\p{M}'’-])${DISPLAY_WORD}(?:(?:[ \\t]*,[ \\t]*|[ \\t]+)${DISPLAY_WORD}){0,5})` +
    `[ \\t]*<(?=[^<>\\s@]{1,64}@[^<>\\s@]{1,190}>)`,
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
const NATIONAL_ID = /(?<![\w.+-])\d{2}([-./ ]?)\d{2}\1\d{2}[-./ ]?\d{3}[-./ ]?\d{2}(?![\w.-]?\d)/g;

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
      const literal =
        ALREADY_REDACTED.test(inner) || SCALAR.test(inner) || DATE_OR_TIME.test(inner);
      if (SPECIFIC_NAME_KEYS.has(key.toLowerCase()) ? literal : isMachineToken(inner)) return match;
    }
    const trailing = quoted ? '' : value.slice(inner.length);
    const replacement = quoted ? `${first}${redacted(type)}${first}` : redacted(type);
    return `${quote}${key}${quote}${separator}${replacement}${trailing}`;
  };
}

/**
 * Redacts quoted strings that are array elements, in arrays of any length or depth:
 * `["Jan Peeters", ...]`, `[{"id":1},"Jan Peeters"]`. One linear pass with a stack of open
 * `[` / `{`. A string directly inside `[` is an element unless a `:` follows it (then it is a
 * key). Machine tokens stay. A stray `]` or `}` changes nothing. A quote without a closing quote
 * on the same line, or an apostrophe inside a word ("don't"), is plain text, so a missing quote
 * cannot hide an array later on the line.
 */
function scrubArrayStrings(text: string): string {
  const stack: string[] = [];
  // Per quote character: the end of the line on which it was already found unclosed. A later
  // quote of that kind before this point is plain text, which keeps the scan linear.
  const unclosedUntil: Record<string, number> = { '"': -1, "'": -1 };
  let out = '';
  let copied = 0;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '[' || char === '{') {
      stack.push(char);
    } else if (char === ']' || char === '}') {
      if (stack[stack.length - 1] === (char === ']' ? '[' : '{')) stack.pop();
    } else if (
      (char === '"' || char === "'") &&
      i >= unclosedUntil[char] &&
      !(char === "'" && /\p{L}/u.test(text[i - 1] ?? '') && /\p{L}/u.test(text[i + 1] ?? ''))
    ) {
      // An apostrophe between two letters (O'Brien) is part of the item, not its closing quote.
      const isInWordApostrophe = (at: number): boolean =>
        char === "'" && /\p{L}/u.test(text[at - 1] ?? '') && /\p{L}/u.test(text[at + 1] ?? '');
      let end = i + 1;
      while (
        end < text.length &&
        text[end] !== '\n' &&
        (text[end] !== char || isInWordApostrophe(end))
      ) {
        end += text[end] === '\\' ? 2 : 1;
      }
      if (end < text.length && text[end] === char) {
        if (stack[stack.length - 1] === '[') {
          let next = end + 1;
          while (text[next] === ' ' || text[next] === '\t') next++;
          const content = text.slice(i + 1, end);
          if (text[next] !== ':' && !isMachineToken(content)) {
            out += text.slice(copied, i + 1) + redacted('name');
            copied = end;
          }
        }
        i = end + 1;
        continue;
      }
      unclosedUntil[char] = end;
    }
    i++;
  }
  return out + text.slice(copied);
}

// Stateless second pass for list items: a quoted string right after `[` or `,` and right
// before `,` or `]`. The scanner tracks quote state, so a stray quote earlier on the line can
// make it misread a list; this pass does not depend on that state.
// Items may sit in [], (), {} and be separated by , or ; with any whitespace. An apostrophe
// between two letters (D'Hondt, O'Brien) is part of the item, not a quote. ’ is never a
// delimiter, so it is plain content. The two branches never match the same character, so a
// failed match cannot backtrack exponentially. Each \s* run is scanned by at most two
// candidate quotes, so the lookarounds stay linear without a length cap.
const LIST_ITEM =
  /(?<=[[({,;]\s*)(["'])((?:[^"'\n]|(?<=\p{L})'(?=\p{L})){1,200})\1(?=\s*[,;\])}])/gu;

function scrubListItems(text: string): string {
  return text.replace(LIST_ITEM, (match: string, quote: string, content: string) =>
    isMachineToken(content) ? match : `${quote}${redacted('name')}${quote}`,
  );
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
  result = scrubArrayStrings(result);
  result = scrubListItems(result);
  result = result.replace(ADDRESS_KV, redactValue('address', true));
  result = scrubIbans(result);
  result = scrubNationalIds(result);
  result = result.replace(DISPLAY_NAME, `${redacted('name')} <`);
  result = result.replace(EMAIL, redacted('email'));
  result = scrubPhones(result);
  result = scrubLongBlobs(result);
  return neutraliseMarkup(result);
}
