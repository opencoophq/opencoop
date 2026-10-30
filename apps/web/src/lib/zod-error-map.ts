import type { z } from 'zod';

type ErrorMap = z.core.$ZodErrorMap;
type Issue = Parameters<ErrorMap>[0];

/** Translator for the `validation` message namespace. */
export type ValidationTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * Fields with their own "please fill this in" message (`validation.requiredField.<field>`).
 * Any other field gets the generic `validation.required`.
 */
export const REQUIRED_FIELDS = [
  'email',
  'password',
  'confirmPassword',
  'firstName',
  'lastName',
  'companyName',
  'birthDate',
  'name',
  'title',
  'giftCode',
  'exDividendDate',
  'dateStr',
  'timeStr',
  'street',
  'number',
  'houseNumber',
  'postalCode',
  'city',
  'shareClassId',
] as const;

const PASSWORD_FIELDS = new Set(['password', 'confirmPassword']);

/** Regex checks on these fields get a field-specific hint instead of the generic message. */
const FORMAT_HINTS: Record<string, string> = {
  password: 'passwordComplexity',
  dateStr: 'dateFormat',
  timeStr: 'timeFormat',
  slug: 'slugFormat',
  coopSlug: 'slugFormat',
};

function fieldOf(issue: Issue): string | undefined {
  const path = issue.path ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    if (typeof path[i] === 'string') return path[i] as string;
  }
  return undefined;
}

function isEmpty(input: unknown): boolean {
  return input === undefined || input === null || (typeof input === 'string' && input.trim() === '');
}

/**
 * Builds a zod error map that turns every issue into plain, translated text.
 * It always returns a string, so zod's built-in English messages never reach the user.
 * Messages set on a schema (`.min(1, '...')`) still take precedence over this map.
 */
export function createZodErrorMap(t: ValidationTranslator): ErrorMap {
  const required = (field: string | undefined) =>
    field && (REQUIRED_FIELDS as readonly string[]).includes(field)
      ? t(`requiredField.${field}`)
      : t('required');

  return (issue) => {
    const field = fieldOf(issue);

    if (issue.code === 'custom') {
      if (issue.params?.required) return required(field);
      if (field === 'confirmPassword') return t('passwordMismatch');
      return t('invalid');
    }

    // An empty field always reads as "fill this in", whatever check it failed.
    if (isEmpty(issue.input) && issue.code !== 'invalid_union') return required(field);

    switch (issue.code) {
      case 'invalid_type':
        if (issue.expected === 'int') return t('wholeNumber');
        if (issue.expected === 'number' || issue.expected === 'bigint') return t('number');
        return t('invalid');

      case 'too_small': {
        const min = Number(issue.minimum);
        if (issue.origin === 'string') {
          if (min <= 1) return required(field);
          if (field && PASSWORD_FIELDS.has(field)) return t('passwordTooShort', { min });
          return t('tooShort', { min });
        }
        if (issue.origin === 'number' || issue.origin === 'bigint') {
          return issue.inclusive ? t('numberTooSmall', { min }) : t('numberAbove', { min });
        }
        return required(field);
      }

      case 'too_big': {
        const max = Number(issue.maximum);
        if (issue.origin === 'number' || issue.origin === 'bigint') {
          return issue.inclusive ? t('numberTooBig', { max }) : t('numberBelow', { max });
        }
        return t('tooLong', { max });
      }

      case 'invalid_format':
        if (issue.format === 'email') return t('email');
        if (issue.format === 'regex' && field && FORMAT_HINTS[field]) return t(FORMAT_HINTS[field]);
        return t('invalid');

      case 'invalid_value':
        if (issue.values.length === 1 && issue.values[0] === true) return t('mustAccept');
        return t('select');

      case 'invalid_union': {
        // Union members are mapped first; reuse the first member's message.
        const nested = issue.errors?.[0]?.[0]?.message;
        return nested ?? t('invalid');
      }

      default:
        return t('invalid');
    }
  };
}
