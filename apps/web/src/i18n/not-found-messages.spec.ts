/**
 * app/[locale]/not-found.tsx renders these keys for every locale. A missing key would
 * show the raw key path on the 404 page instead of text.
 */
import { createTranslator } from 'next-intl';
import { routing } from './routing';
import en from '../../messages/en.json';
import nl from '../../messages/nl.json';
import fr from '../../messages/fr.json';
import de from '../../messages/de.json';

const MESSAGES = { en, nl, fr, de } as const;
const KEYS = ['notFound', 'notFoundDescription', 'backToHome'] as const;

it('has messages for every routed locale', () => {
  expect(Object.keys(MESSAGES).sort()).toEqual([...routing.locales].sort());
});

describe.each(Object.entries(MESSAGES))('not-found messages (%s)', (locale, messages) => {
  const t = createTranslator({ locale, messages, namespace: 'errors' });

  it.each(KEYS)('formats errors.%s', (key) => {
    const text = t(key);
    expect(text.trim()).not.toBe('');
    expect(text).not.toContain('errors.');
  });
});
