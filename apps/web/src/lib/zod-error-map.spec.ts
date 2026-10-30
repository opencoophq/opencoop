import { zodResolver } from '@hookform/resolvers/zod';
import { createTranslator } from 'next-intl';
import { z } from 'zod';
import nl from '../../messages/nl.json';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import de from '../../messages/de.json';
import { createZodErrorMap, REQUIRED_FIELDS, type ValidationTranslator } from './zod-error-map';

const MESSAGES = { nl, en, fr, de } as const;
type Locale = keyof typeof MESSAGES;

// Fragments of zod's built-in English messages that must never reach a user.
const ZOD_DEFAULTS = /Too small|Too big|expected|Invalid (input|email|string|option)|Required/;

function useLocale(locale: Locale) {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: 'validation' });
  z.config({ customError: createZodErrorMap(t as unknown as ValidationTranslator) });
}

async function errorsFor<T extends z.ZodType>(schema: T, values: Record<string, unknown>) {
  const result = await zodResolver(schema as never)(values as never, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  return Object.fromEntries(
    Object.entries(result.errors).map(([field, error]) => [field, (error as { message?: string }).message]),
  );
}

// Same schemas as components/auth/email-first-login.tsx.
const loginEmail = z.object({ email: z.string().email() });
const loginPassword = z.object({ password: z.string().min(1) });

afterAll(() => {
  z.config({ customError: undefined });
});

describe('zod error map', () => {
  it.each([
    ['nl', 'Vul je wachtwoord in', 'Vul je e-mailadres in', 'Vul een geldig e-mailadres in'],
    ['en', 'Enter your password', 'Enter your email address', 'Enter a valid email address'],
    ['fr', 'Saisissez votre mot de passe', 'Saisissez votre adresse e-mail', 'Saisissez une adresse e-mail valide'],
    ['de', 'Geben Sie Ihr Passwort ein', 'Geben Sie Ihre E-Mail-Adresse ein', 'Geben Sie eine gültige E-Mail-Adresse ein'],
  ] as const)('login messages in %s', async (locale, emptyPassword, emptyEmail, badEmail) => {
    useLocale(locale);

    expect(await errorsFor(loginPassword, { password: '' })).toEqual({ password: emptyPassword });
    expect(await errorsFor(loginEmail, { email: '' })).toEqual({ email: emptyEmail });
    expect(await errorsFor(loginEmail, { email: 'jan@' })).toEqual({ email: badEmail });
  });

  it('gives field-specific messages for the shapes used in our forms', async () => {
    useLocale('nl');
    const schema = z
      .object({
        password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/),
        confirmPassword: z.string().min(8),
        email: z.string().email().optional().or(z.literal('')),
        dateStr: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        quantity: z.coerce.number().int().min(1).max(50),
        year: z.coerce.number().min(2000),
        type: z.enum(['SOLAR', 'WIND']),
        acceptTerms: z.literal(true),
        nickname: z.string().min(3),
      })
      .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'] });

    expect(
      await errorsFor(schema, {
        password: 'abc',
        confirmPassword: 'abcdefgh',
        email: 'nope',
        dateStr: '2026-10-30',
        slug: 'Not A Slug',
        quantity: '99',
        year: '1999',
        type: 'COAL',
        acceptTerms: false,
        nickname: 'ab',
      }),
    ).toEqual({
      password: 'Je wachtwoord moet minstens 8 tekens hebben',
      email: 'Vul een geldig e-mailadres in',
      dateStr: 'Vul de datum in als DD/MM/JJJJ',
      slug: 'Gebruik alleen kleine letters, cijfers en streepjes',
      quantity: 'Vul een getal van hoogstens 50 in',
      year: 'Vul een getal van minstens 2000 in',
      type: 'Kies een van de opties',
      acceptTerms: 'Vink dit aan om verder te gaan',
      nickname: 'Vul minstens 3 tekens in',
    });

    expect(
      await errorsFor(schema, {
        password: 'abcdefgh',
        confirmPassword: 'abcdefgx',
        email: '',
        dateStr: '30/10/2026',
        slug: 'ok',
        quantity: '1',
        year: '2026',
        type: 'SOLAR',
        acceptTerms: true,
        nickname: 'abc',
      }),
    ).toEqual({
      password: 'Je wachtwoord moet een kleine letter, een hoofdletter en een cijfer bevatten',
      confirmPassword: 'De wachtwoorden zijn niet hetzelfde',
    });
  });

  it('turns a refine without a message into a friendly mismatch message', async () => {
    useLocale('nl');
    const schema = z
      .object({ password: z.string(), confirmPassword: z.string() })
      .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'] });

    expect(await errorsFor(schema, { password: 'a', confirmPassword: 'b' })).toEqual({
      confirmPassword: 'De wachtwoorden zijn niet hetzelfde',
    });
  });

  it('maps custom "required" issues per field and falls back to a generic message', async () => {
    useLocale('en');
    const schema = z.object({ firstName: z.string(), nickname: z.string() }).superRefine((_, ctx) => {
      ctx.addIssue({ code: 'custom', path: ['firstName'], params: { required: true } });
      ctx.addIssue({ code: 'custom', path: ['nickname'], params: { required: true } });
    });

    expect(await errorsFor(schema, { firstName: '', nickname: '' })).toEqual({
      firstName: 'Enter a first name',
      nickname: 'Please fill in this field',
    });
  });

  it.each(Object.keys(MESSAGES) as Locale[])('never returns zod English defaults in %s', async (locale) => {
    useLocale(locale);
    const schema = z.object({
      a: z.string(),
      b: z.number(),
      c: z.string().max(2),
      d: z.string().url(),
      e: z.number().gt(0),
      f: z.array(z.string()).min(1),
      g: z.coerce.number(),
    });

    const errors = await errorsFor(schema, { b: 'x', c: 'abc', d: 'nope', e: 0, f: [], g: 'abc' });

    expect(Object.keys(errors).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    for (const message of Object.values(errors)) {
      expect(message).toBeTruthy();
      expect(message).not.toMatch(ZOD_DEFAULTS);
      expect(message).not.toMatch(/validation\./);
    }
  });
});

describe('validation messages', () => {
  const keysOf = (obj: object, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it('has the same keys in every locale', () => {
    const expected = keysOf(nl.validation).sort();
    for (const messages of [en, fr, de]) {
      expect(keysOf(messages.validation).sort()).toEqual(expected);
    }
  });

  it('has a message for every field-specific required message', () => {
    expect(Object.keys(nl.validation.requiredField).sort()).toEqual([...REQUIRED_FIELDS].sort());
  });

  it('uses no em or en dashes', () => {
    for (const messages of [nl, en, fr, de]) {
      expect(JSON.stringify(messages.validation)).not.toMatch(/[–—]/);
    }
  });
});
