import { scrubFeedbackText } from './feedback-scrubber';

const SECRET = '[REDACTED:secret]';
const NAME = '[REDACTED:name]';
const IBAN = '[REDACTED:iban]';
const NATIONAL_ID = '[REDACTED:national_id]';
const EMAIL = '[REDACTED:email]';
const PHONE = '[REDACTED:phone]';

describe('scrubFeedbackText', () => {
  describe('secrets', () => {
    it.each([
      ['Authorization: Bearer abc.def-ghi_123', 'Authorization: Bearer ' + SECRET],
      ['bearer xyz123token', 'bearer ' + SECRET],
      [
        'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c here',
        `jwt ${SECRET} here`,
      ],
      ['ghp_' + 'a'.repeat(36), SECRET],
      ['gho_' + 'B1'.repeat(18), SECRET],
      ['ghs_' + 'c2'.repeat(18), SECRET],
      ['github_pat_11ABCDEFG0' + 'x_y'.repeat(20), SECRET],
      ['key sk-proj-abcdefghijklmnop1234', `key ${SECRET}`],
      ['sk-ant-api03-abcdefghijklmnopqrstu', SECRET],
      ['AKIAIOSFODNN7EXAMPLE', SECRET],
      ['ASIAIOSFODNN7EXAMPLE used', `${SECRET} used`],
      ['used oc_abcdefghijklmnop_1234-5678 key', `used ${SECRET} key`],
      ['password=hunter2', `password=${SECRET}`],
      ['PWD: hunter2', `PWD: ${SECRET}`],
      ['{"client_secret": "abc123"}', `{"client_secret": "${SECRET}"}`],
      ["{ refresh_token: 'r-1' }", `{ refresh_token: '${SECRET}' }`],
      ['api-key=abc&x=1', `api-key=${SECRET}&x=1`],
      ['apikey: zzz', `apikey: ${SECRET}`],
      ['"access_token":"tok"', `"access_token":"${SECRET}"`],
      ['private_key=-----BEGIN', `private_key=${SECRET}`],
      ['secret = s3cr3t, next', `secret = ${SECRET}, next`],
      ['passwd=x', `passwd=${SECRET}`],
      ['token=abc', `token=${SECRET}`],
      ['JWT_SECRET=abc', `JWT_SECRET=${SECRET}`],
      ['x-api-key: abc', `x-api-key: ${SECRET}`],
      ['DB_PASSWORD=hunter2', `DB_PASSWORD=${SECRET}`],
      ['{"stripeSecretKey": "rk_live_1"}', `{"stripeSecretKey": "${SECRET}"}`],
      ['csrf_token=abc', `csrf_token=${SECRET}`],
      ['private-key: abc', `private-key: ${SECRET}`],
      ['hash ' + 'a1b2c3d4'.repeat(4), `hash ${SECRET}`],
      ['blob ' + 'QWxhZGRpbjpvcGVuIHNlc2FtZQ12'.repeat(2), `blob ${SECRET}`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it('keeps "Bearer" when the authorization header value was already redacted', () => {
      expect(scrubFeedbackText('authorization: Bearer abcdef')).toBe(
        `authorization: Bearer ${SECRET}`,
      );
    });

    it('keeps keys that only contain a secret word, and long lowercase words', () => {
      const text =
        'passwordHash and token_count=3 and max_tokens: 5 and tool_name: x and share_class_name: A and src/modules/mcp/feedback/feedback-rate-limiter';
      expect(scrubFeedbackText(text)).toBe(text);
    });
  });

  describe('names in structured payloads', () => {
    it.each([
      ['{"name": "Jan Peeters"}', `{"name": "${NAME}"}`],
      [
        "{ firstName: 'Jan', lastName: 'Peeters' }",
        `{ firstName: '${NAME}', lastName: '${NAME}' }`,
      ],
      ['first_name=Jan&last_name=Peeters', `first_name=${NAME}&last_name=${NAME}`],
      ['{"FullName":"Jan P"}', `{"FullName":"${NAME}"}`],
      ['displayName: Jan Peeters\nnext', `displayName: ${NAME}\nnext`],
      ['{ accountHolder: Jan Peeters, id: 4 }', `{ accountHolder: ${NAME}, id: 4 }`],
      ['"counterpartyName": "Jan"', `"counterpartyName": "${NAME}"`],
      ['beneficiaryName=Jan]', `beneficiaryName=${NAME}]`],
      ['"signedByName": "Jan"', `"signedByName": "${NAME}"`],
      ['"customer": Jan Peeters }', `"customer": ${NAME} }`],
      ["{ name: 'Jan' }", `{ name: '${NAME}' }`],
      ["'holder': Jan", `'holder': ${NAME}`],
      ['lastName: Peeters', `lastName: ${NAME}`],
      ['"member": "Jan"', `"member": "${NAME}"`],
      ['"holder": "Jan"', `"holder": "${NAME}"`],
      ['account_holder=Jan', `account_holder=${NAME}`],
      ['"contactName": "Jan"', `"contactName": "${NAME}"`],
      ['"shareholderName": "Jan"', `"shareholderName": "${NAME}"`],
      ['memberName=Jan', `memberName=${NAME}`],
      ['customerName=Jan', `customerName=${NAME}`],
      ['full_name=Jan', `full_name=${NAME}`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it.each([
      'tool_name: "list_shareholders"',
      '{"tool_name": "list_shareholders"}',
      '{"share_class_name": "A shares", "coopName": "Bronsgroen"}',
      '{"name": null, "member": 42, "holder": true}',
      '{"name": {"first": 1}}',
      '"customer": [1, 2]',
      'Tool name: list_shareholders returns 500',
      'member: since 2020',
      'customer: unknown in the export',
      'holder=bank',
    ])('keeps %s', (input) => {
      expect(scrubFeedbackText(input)).toBe(input);
    });

    it('redacts names nested in a JSON payload and keeps the structure', () => {
      const payload = JSON.stringify({
        tool_name: 'get_shareholder',
        shareholder: { id: 'cm1abc', name: 'Jan Peeters', contact: { email: 'jan@example.be' } },
        customer: { name: 'Els' },
      });
      expect(JSON.parse(scrubFeedbackText(payload))).toEqual({
        tool_name: 'get_shareholder',
        shareholder: { id: 'cm1abc', name: NAME, contact: { email: EMAIL } },
        customer: { name: NAME },
      });
    });
  });

  describe('IBAN', () => {
    it.each([
      'BE68 5390 0754 7034',
      'BE68539007547034',
      'NL91ABNA0417164300',
      'NL91 ABNA 0417 1643 00',
      'BE68-5390-0754-7034',
      'BE68.5390.0754.7034',
      'be68 5390 0754 7034',
      'be68539007547034',
    ])('redacts %s', (iban) => {
      expect(scrubFeedbackText(`iban ${iban} paid`)).toBe(`iban ${IBAN} paid`);
    });
  });

  it.each(['clx1abc2def3ghi4jkl5mno6', 'id xx12 3456 7890 1234 here', 'AB12345678901234'])(
    'keeps non-IBAN %s',
    (text) => {
      expect(scrubFeedbackText(text)).toBe(text);
    },
  );

  describe('Belgian national register number', () => {
    it.each([
      '85.07.30-033.28',
      '850730-033-28',
      '850730 033 28',
      '85073003328',
      '85.07.30-033-28',
      '85.07.30.033.28',
      '850730.033.28',
    ])('redacts %s', (id) => {
      expect(scrubFeedbackText(`rrn ${id}.`)).toBe(`rrn ${NATIONAL_ID}.`);
    });
  });

  it('redacts emails', () => {
    expect(scrubFeedbackText('mail jan.peeters+x@mail.example.be now')).toBe(`mail ${EMAIL} now`);
  });

  describe('phones', () => {
    it.each([
      '+32 470 12 34 56',
      '+32 (0)470/12.34.56',
      '+31612345678',
      '+1 415 555 0100',
      '0470 12 34 56',
      '0470/12.34.56',
      '02 123 45 67',
      '09/123.45.67',
      '0470123456',
      '0475-12-34-56',
      '0475.12.34.56',
      '0032 475 12 34 56',
      '0032475123456',
    ])('redacts %s', (phone) => {
      expect(scrubFeedbackText(`call ${phone} today`)).toBe(`call ${PHONE} today`);
    });

    it.each([
      'on 2026-11-18 at 10:30:00',
      'amount 1.250,00 EUR',
      'version 0.1.22 and v2026.47.2',
      'OGM +++090/9337/55493+++',
      'id cmhx5abc0000qz2l3k9f8d7e6',
      'count 42 in 2026',
      'uuid 3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'date 05/01/2026',
      'date 05-01-2026 and 18.11.2026',
      'total 0,50 and 0.25',
    ])('keeps %s', (text) => {
      expect(scrubFeedbackText(text)).toBe(text);
    });
  });

  describe('markup', () => {
    it('neutralises GitHub mentions but not emails', () => {
      expect(scrubFeedbackText('ping @wooter and @opencoop/database')).toBe(
        'ping @​wooter and @​opencoop/database',
      );
      expect(scrubFeedbackText('@start')).toBe('@​start');
    });

    it('cannot fake the fingerprint marker', () => {
      expect(scrubFeedbackText('<!-- mcp-feedback-fingerprint: abc -->')).toBe(
        '&lt;!-- mcp-feedback-fingerprint: abc -->',
      );
    });
  });

  it('scrubs mixed text with several items', () => {
    const text =
      'Shareholder jan@example.be (IBAN BE68 5390 0754 7034, phone +32 470 12 34 56, ' +
      'rrn 85.07.30-033.28) failed with key oc_abcdefghijklmnopqrstuvwx and {"name": "Jan"} in list_shareholders';
    expect(scrubFeedbackText(text)).toBe(
      `Shareholder ${EMAIL} (IBAN ${IBAN}, phone ${PHONE}, rrn ${NATIONAL_ID}) failed with key ` +
        `${SECRET} and {"name": "${NAME}"} in list_shareholders`,
    );
  });

  it('is idempotent', () => {
    const inputs = [
      'Authorization: Bearer abc.def password=x token: "y" {"name": "Jan", "x": {"holder": "Els"}}',
      'jan@example.be BE68 5390 0754 7034 85.07.30-033.28 +32 470 12 34 56 0470/12.34.56 @user <!-- x',
      '"name"=Jan Peeters & first_name: Els\n"member": Bob',
      'Tool name: list_shareholders returns 500',
      'ghp_' + 'a'.repeat(36) + ' ' + 'f'.repeat(40),
    ];
    for (const input of inputs) {
      const once = scrubFeedbackText(input);
      expect(scrubFeedbackText(once)).toBe(once);
    }
  });
});

describe('scrubFeedbackText long email local part', () => {
  it('still redacts the address when the local part is longer than 64 characters', () => {
    const result = scrubFeedbackText(`contact ${'a'.repeat(80)}@example.be please`);
    expect(result).toContain('[REDACTED:email]');
    expect(result).not.toContain('example.be');
  });
});

describe('scrubFeedbackText performance', () => {
  // Inputs are capped at 4000 chars; no pattern may backtrack quadratically or worse.
  const inputs: Record<string, string> = {
    'digit run': '0'.repeat(4000),
    '00 run': '00' + '1'.repeat(3998),
    '+ run': '+3' + '2'.repeat(3998) + 'x',
    'separated + run': '+32' + ' 1'.repeat(1990) + 'a',
    'dotted 0 run': '0' + '1.'.repeat(1999),
    'email local part without domain': 'a.'.repeat(1990) + '@',
    'base64-like run': 'aA1'.repeat(1333) + '!',
    'unterminated name value': '"name": "' + 'a'.repeat(3990),
    'national id run': '12.34.56-'.repeat(444),
  };

  it.each(Object.entries(inputs))('%s finishes in under 50 ms', (_label, input) => {
    const start = Date.now();
    scrubFeedbackText(input);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
