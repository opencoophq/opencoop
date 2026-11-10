/**
 * The sender-domain card renders every string below through next-intl (ICU).
 * An unescaped `<noreply@x>` is parsed as a rich-text tag and throws
 * INVALID_TAG, which breaks the whole settings page. Format every string in
 * every locale with the arguments the card passes.
 */
import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';
import nl from '../../messages/nl.json';
import fr from '../../messages/fr.json';
import de from '../../messages/de.json';

const LOCALES = { en, nl, fr, de } as const;

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix: string): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}.${key}`] : leaves(value, `${prefix}.${key}`),
  );
}

const ARGS = {
  example: 'Bronsgroen <noreply@bronsgroen.be>',
  domain: 'bronsgroen.be',
  address: 'noreply@bronsgroen.be',
  replyTo: 'info@bronsgroen.be',
};

describe.each(Object.entries(LOCALES))('senderDomain messages (%s)', (locale, messages) => {
  const keys = leaves(messages.admin.settings.senderDomain as Tree, 'admin.settings.senderDomain');

  it('formats every string without an ICU error', () => {
    const t = createTranslator({
      locale,
      messages: messages as never,
      onError: (e) => {
        throw e;
      },
    });
    for (const key of keys) {
      expect(() => (t as (k: string, v: object) => string)(key, ARGS)).not.toThrow();
    }
  });

  it('has the same keys as English', () => {
    const base = leaves(en.admin.settings.senderDomain as Tree, 'admin.settings.senderDomain');
    expect(keys.sort()).toEqual(base.sort());
  });

  it('shows the example address literally in the intro', () => {
    const t = createTranslator({ locale, messages: messages as never });
    const intro = (t as (k: string, v: object) => string)(
      'admin.settings.senderDomain.intro',
      ARGS,
    );
    expect(intro).toContain('Bronsgroen <noreply@bronsgroen.be>');
  });
});
