import {
  FEEDBACK_NAME_KEYS,
  FEEDBACK_SPECIFIC_NAME_KEYS,
  scrubFeedbackText,
} from './feedback-scrubber';

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
      ['{ accountHolder: Jan Peeters, id: 4 }', `{ accountHolder: ${NAME} }`],
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

describe('scrubFeedbackText names, review round 2', () => {
  const ADDRESS = '[REDACTED:address]';

  describe('new name keys', () => {
    it.each([
      ['{"shareholder": "Jan Peeters"}', `{"shareholder": "${NAME}"}`],
      ['{"payee": "Jan"}', `{"payee": "${NAME}"}`],
      ['payee: Jan', `payee: ${NAME}`],
      ['{"from": "Jan Peeters"}', `{"from": "${NAME}"}`],
      ["{ to: 'Els' }", `{ to: '${NAME}' }`],
      ['sender=Jan', `sender=${NAME}`],
      ['"recipient": "Els"', `"recipient": "${NAME}"`],
      ['"author": "Els"', `"author": "${NAME}"`],
      ['"contact": "Els Peeters"', `"contact": "${NAME}"`],
      ['"partner": "Els"', `"partner": "${NAME}"`],
      ['organizer: Els', `organizer: ${NAME}`],
      ['"attendee": "Els"', `"attendee": "${NAME}"`],
      ['assignee=Els', `assignee=${NAME}`],
      ['"created_by": "Els"', `"created_by": "${NAME}"`],
      ['createdBy: Els', `createdBy: ${NAME}`],
      ['"beneficiary": "Els"', `"beneficiary": "${NAME}"`],
      ['"owner": "Els"', `"owner": "${NAME}"`],
      ['"user": "Els Peeters"', `"user": "${NAME}"`],
      ['legalRepresentative: Els', `legalRepresentative: ${NAME}`],
      ['"legal_representative": "Els"', `"legal_representative": "${NAME}"`],
      ['companyName: Peeters BV', `companyName: ${NAME}`],
      ['"company_name": "Peeters BV"', `"company_name": "${NAME}"`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it.each([
      '{"from": "2026-10-01", "to": "2026-10-01T10:00:00Z"}',
      '{"from": "01/10/2026 10:00"}',
      '{"user": "clx1abc2def", "owner": "usr_42"}',
      '{"owner": 42, "user": null, "partner": true, "contact": {"id": 1}, "to": ["a"]}',
      'Tool name: get_x',
      'from 2026 to 2027',
      'send to admin',
      'user: admin',
      'from: 2026',
    ])('keeps %s', (input) => {
      expect(scrubFeedbackText(input)).toBe(input);
    });
  });

  describe('unquoted generic key with a capitalised name', () => {
    it.each([
      ['name: Jan Peeters', `name: ${NAME}`],
      ['Name: Jan Peeters', `Name: ${NAME}`],
      ['member: Jan Peeters, joined 2020', `member: ${NAME}`],
      ['holder: Marie Van den Berg', `holder: ${NAME}`],
      ['owner: Émile Dupré', `owner: ${NAME}`],
      ['to: Jan de Smet', `to: ${NAME}`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    // Redact by default: prose after a name key is redacted too (accepted over-redaction).
    it.each([
      ['Tool name: List shareholders', `Tool name: ${NAME}`],
      ['name: Jan', `name: ${NAME}`],
      ['member: since 2020', `member: ${NAME}`],
      ['Tool name: list_shareholders returns 500', `Tool name: ${NAME}`],
      ['customer: unknown in the export', `customer: ${NAME}`],
      ['owner: the coop', `owner: ${NAME}`],
    ])('redacts prose after a name key: %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });
  });

  describe('display name before an email', () => {
    it.each([
      ['sent by Jan Peeters <jan@x.be> today', `${NAME} <${EMAIL}> today`],
      ['"Jan Peeters" <jan@x.be>', `${NAME} <${EMAIL}>`],
      ['Émile Dupré <emile@x.be>', `${NAME} <${EMAIL}>`],
      ['Marie van den Berg <m@x.be>', `${NAME} <${EMAIL}>`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it('treats any word before <email> as a name, but stops at a colon', () => {
      expect(scrubFeedbackText('mail <jan@x.be>')).toBe(`${NAME} <${EMAIL}>`);
      expect(scrubFeedbackText('mail: <jan@x.be>')).toBe(`mail: <${EMAIL}>`);
    });
  });

  describe('two-element tuples', () => {
    it.each([
      ['[42, "Jan Peeters"]', `[42, "${NAME}"]`],
      ['["cuid123", "Jan Peeters"]', `["cuid123", "${NAME}"]`],
      ["[7,'Marie van den Berg']", `[7,'${NAME}']`],
      ['rows: [[1, "Jan"], [2, "Els Peeters"]]', `rows: [[1, "${NAME}"], [2, "${NAME}"]]`],
      ['[1, "Jan Peeters", 3]', `[1, "${NAME}", 3]`],
      ['["two words", "Jan Peeters"]', `["${NAME}", "${NAME}"]`],
      ['[1, "Jan Peeters Is Here Now Today"]', `[1, "${NAME}"]`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it.each(['[1,2]', '["a",1]', '["list_shareholders", "error"]'])('keeps %s', (input) => {
      expect(scrubFeedbackText(input)).toBe(input);
    });
  });

  describe('Belgian phones with the area code in brackets', () => {
    it.each(['(02) 123 45 67', '(0475) 12 34 56', '(09)/123.45.67'])('redacts %s', (phone) => {
      expect(scrubFeedbackText(`call ${phone} today`)).toBe(`call ${PHONE} today`);
    });

    it.each(['f(0) returns 12', 'list (02) items', '(2026) 12 34'])('keeps %s', (input) => {
      expect(scrubFeedbackText(input)).toBe(input);
    });
  });

  describe('addresses', () => {
    it.each([
      ['address: Kerkstraat 1, 2000 Antwerpen\nnext', `address: ${ADDRESS}\nnext`],
      ['{"street": "Kerkstraat 1, bus 2"}', `{"street": "${ADDRESS}"}`],
      ['adres: Kerkstraat 1', `adres: ${ADDRESS}`],
      ["straat='Kerkstraat 1'", `straat='${ADDRESS}'`],
      ['"streetAddress": "Kerkstraat 1"', `"streetAddress": "${ADDRESS}"`],
      ['street_address: Kerkstraat 1', `street_address: ${ADDRESS}`],
      ['"addressLine1": "Kerkstraat 1"', `"addressLine1": "${ADDRESS}"`],
      ['address_line_1=Kerkstraat 1', `address_line_1=${ADDRESS}`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it.each(['{"address": null}', '{"emailAddress": "[REDACTED:email]"}', 'ipAddress: 10'])(
      'keeps %s',
      (input) => {
        expect(scrubFeedbackText(input)).toBe(input);
      },
    );
  });

  it('is idempotent for every new case', () => {
    const inputs = [
      '{"shareholder": "Jan Peeters", "from": "2026-10-01", "user": "usr_42", "to": "Els"}',
      'name: Jan Peeters\nholder: Marie Van den Berg\nTool name: List shareholders',
      '"Jan Peeters" <jan@x.be> and Émile Dupré <emile@x.be>',
      '[42, "Jan Peeters"] ["cuid123", "Jan Peeters"] [1,2]',
      '(02) 123 45 67 and (0475) 12 34 56',
      'address: Kerkstraat 1, 2000 Antwerpen\n{"street": "Kerkstraat 1"}',
    ];
    for (const input of inputs) {
      const once = scrubFeedbackText(input);
      expect(once).not.toBe(input);
      expect(scrubFeedbackText(once)).toBe(once);
    }
  });
});

describe('scrubFeedbackText redacts names by default', () => {
  describe('name-keyed values: redact unless a machine token', () => {
    it.each([
      ['name: Jan', `name: ${NAME}`],
      ['shareholder: jan peeters', `shareholder: ${NAME}`],
      ['contact: Peeters, Jan', `contact: ${NAME}`],
      ['from: de Smet Anna', `from: ${NAME}`],
      ['firstName: Peeters, Jan', `firstName: ${NAME}`],
      ['owner: Marie', `owner: ${NAME}`],
      ['name: Jan, id: 4 | next', `name: ${NAME} | next`],
      ['name: Marie-Claire', `name: ${NAME}`],
      ['{"name": null, "contact": Jan Peeters}', `{"name": null, "contact": ${NAME}}`],
      ['{"member": 42, "owner": "Jan"}', `{"member": 42, "owner": "${NAME}"}`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it.each([
      'Tool name: get_x',
      'name: list_shareholders',
      'from: 2026-10-01',
      'to: 2026-10-31',
      'user: clx1abc2def',
      'member: 42',
      '"from": "2026-10-01"',
      '"name": "BE"',
      '"to": "2026-10-01 10:00:00"',
      'owner: api.v2/x',
    ])('keeps %s', (input) => {
      expect(scrubFeedbackText(input)).toBe(input);
    });
  });

  describe('short scalar arrays', () => {
    it.each([
      ['["Jan Peeters", 42]', `["${NAME}", 42]`],
      ['[42, "Jan Peeters", "BE"]', `[42, "${NAME}", "BE"]`],
      ['[42, "jan peeters"]', `[42, "${NAME}"]`],
      ['[42, "Jan"]', `[42, "${NAME}"]`],
      ["['Jan', 'x', 1, 2, 3]", `['${NAME}', 'x', 1, 2, 3]`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });

    it.each([
      '[1,2]',
      '["a",1]',
      '["list_shareholders", "error"]',
      '["BE", "NL"]',
      '[1, 2, 3, 4, 5, 6]',
    ])('keeps %s', (input) => {
      expect(scrubFeedbackText(input)).toBe(input);
    });
  });

  describe('display names before an email, any case', () => {
    it.each([
      ['jan peeters <x@y.be>', `${NAME} <${EMAIL}>`],
      ['Peeters, Jan <x@y.be>', `${NAME} <${EMAIL}>`],
      ['"Jan Peeters" <x@y.be>', `${NAME} <${EMAIL}>`],
      ['see: Marie-Claire Van den Berg <x@y.be>', `see: ${NAME} <${EMAIL}>`],
      ['line one\njan <x@y.be>', `line one\n${NAME} <${EMAIL}>`],
    ])('redacts %s', (input, expected) => {
      expect(scrubFeedbackText(input)).toBe(expected);
    });
  });

  describe('reviewer probe', () => {
    const values = [
      'Jan',
      'jan peeters',
      'Peeters, Jan',
      'de Smet Anna',
      'Émile Dupré',
      'Marie-Claire Van den Berg',
    ];
    const forms: string[] = [];
    const probes: Array<[string, string]> = [];
    for (const value of values) {
      for (const key of FEEDBACK_NAME_KEYS) {
        forms.push(`${key}: ${value}`, `"${key}": "${value}"`, `${key}=${value}`);
        probes.push(
          [value, `${key}: ${value}`],
          [value, `"${key}": "${value}"`],
          [value, `${key}=${value}`],
        );
      }
      probes.push(
        [value, `[42, "${value}"]`],
        [value, `["${value}", 42]`],
        [value, `[42, "${value}", "BE"]`],
        [value, `${value} <a@b.be>`],
        [value, `["${value}", "a", "b", "c", "d", "e"]`],
        [value, `["x1", "x2", "x3", "x4", "x5", "${value}"]`],
        [value, `[{"id": 1}, "${value}"]`],
        [value, `[[1, "${value}"]]`],
        [value, `{"rows": [{"id": 1, "tags": ["a"]}, "${value}"]}`],
      );
    }
    for (const value of ['jan', 'JAN']) {
      for (const key of FEEDBACK_SPECIFIC_NAME_KEYS) {
        probes.push(
          [value, `${key}: ${value}`],
          [value, `"${key}": "${value}"`],
          [value, `${key}=${value}`],
        );
      }
    }

    function leakedTokens(value: string, output: string): string[] {
      const lower = output.toLowerCase();
      return value
        .split(/[^\p{L}]+/u)
        .filter((token) => token.length >= 3 && !['de', 'van'].includes(token.toLowerCase()))
        .filter((token) => lower.includes(token.toLowerCase()));
    }

    it('covers every name key in every form', () => {
      expect(forms.length).toBe(values.length * FEEDBACK_NAME_KEYS.length * 3);
    });

    it('leaks no part of any name value', () => {
      const leaks = probes
        .map(([value, input]) => ({ input, output: scrubFeedbackText(input), value }))
        .filter(({ value, output }) => leakedTokens(value, output).length > 0)
        .map(({ input, output }) => `${input} => ${output}`);
      expect(leaks).toEqual([]);
    });

    it('is idempotent for every probe', () => {
      for (const [, input] of probes) {
        const once = scrubFeedbackText(input);
        expect(scrubFeedbackText(once)).toBe(once);
      }
    });
  });

  it('is idempotent for every new example', () => {
    const inputs = [
      'name: Jan\nshareholder: jan peeters\ncontact: Peeters, Jan\nfrom: 2026-10-01',
      '["Jan Peeters", 42] [42, "Jan Peeters", "BE"] ["BE", "NL"]',
      'jan peeters <x@y.be> and Peeters, Jan <x@y.be>',
      'name: Jan, id: 4 | next',
    ];
    for (const input of inputs) {
      const once = scrubFeedbackText(input);
      expect(scrubFeedbackText(once)).toBe(once);
    }
  });
});

describe('scrubFeedbackText array scanner', () => {
  const SIX = '"Jan Peeters","Marie Dupont","Els Janssens","Tom Claes","An Maes","Piet Wouters"';
  const SIX_REDACTED = Array(6).fill(`"${NAME}"`).join(',');

  it.each([
    [`"attendees": [${SIX}]`, `"attendees": [${SIX_REDACTED}]`],
    [`[${SIX}]`, `[${SIX_REDACTED}]`],
    [`shareholders: [${SIX}]`, `shareholders: [${SIX_REDACTED}]`],
    ['[{"id":1},"Jan Peeters"]', `[{"id":1},"${NAME}"]`],
    ['[[1,"Jan Peeters"]]', `[[1,"${NAME}"]]`],
    ["['Jan Peeters', 'error']", `['${NAME}', 'error']`],
    ['["Jan \\"JP\\" Peeters", 1]', `["${NAME}", 1]`],
    ['stray ] } then ["Jan Peeters"]', `stray ] } then ["${NAME}"]`],
    ['don\'t forget ["Jan Peeters"]', `don't forget ["${NAME}"]`],
    ['"unclosed [\n["Jan Peeters"]', `"unclosed [\n["${NAME}"]`],
  ])('redacts %s', (input, expected) => {
    expect(scrubFeedbackText(input)).toBe(expected);
  });

  it('redacts a 50-name array', () => {
    const names = Array.from(
      { length: 50 },
      (_, i) => `"Person ${String.fromCharCode(65 + (i % 26))}x"`,
    );
    const output = scrubFeedbackText(`[${names.join(', ')}]`);
    expect(output).toBe(`[${Array(50).fill(`"${NAME}"`).join(', ')}]`);
  });

  it.each([
    '["list_shareholders","error","BE"]',
    '[1,2,3,4,5,6,7]',
    '{"a":"Jan Peeters"}',
    'see "Internal error", "Not found"',
    '[{"id": 1, "status": "ACTIVE"}]',
  ])('keeps %s', (input) => {
    expect(scrubFeedbackText(input)).toBe(input);
  });

  it('keeps an object key inside an array context', () => {
    expect(scrubFeedbackText('["Jan Peeters": 1]')).toBe('["Jan Peeters": 1]');
  });
});

describe('scrubFeedbackText name-specific keys', () => {
  it.each([
    ['"firstName":"jan"', `"firstName":"${NAME}"`],
    ['lastName: peeters', `lastName: ${NAME}`],
    ['"shareholderName": "usr_42"', `"shareholderName": "${NAME}"`],
    ['company_name=acme', `company_name=${NAME}`],
    ['createdBy: jp', `createdBy: ${NAME}`],
    ['name: JAN', `name: ${NAME}`],
    ['"to": "ABC"', `"to": "${NAME}"`],
  ])('redacts %s', (input, expected) => {
    expect(scrubFeedbackText(input)).toBe(expected);
  });

  it.each([
    '"firstName": null',
    '"lastName": 42',
    '"fullName": "2026-10-01"',
    'name: BE',
    '"customer": "EUR"',
    'user: clx1abc2def',
  ])('keeps %s', (input) => {
    expect(scrubFeedbackText(input)).toBe(input);
  });
});

describe('scrubFeedbackText long email local part', () => {
  it('still redacts the address when the local part is longer than 64 characters', () => {
    const result = scrubFeedbackText(`contact ${'a'.repeat(80)}@example.be please`);
    expect(result).toContain('[REDACTED:email]');
    expect(result).not.toContain('example.be');
  });
});

describe('scrubFeedbackText long unquoted name value', () => {
  it('redacts the whole value when it is longer than 1000 characters', () => {
    const result = scrubFeedbackText(`name: ${'x '.repeat(600)}Jan Peeters\nnext`);
    expect(result).toBe('name: [REDACTED:name]\nnext');
  });
});

describe('scrubFeedbackText list items after a stray quote', () => {
  it.each([
    'say "hi ["Jan Peeters", "Marie Dupont"]',
    "note 'x ['Jan Peeters', 'Marie Dupont']",
    'a "b" c "d ["Jan Peeters","Marie Dupont","Els Janssens"]',
  ])('redacts every name in %s', (input) => {
    const result = scrubFeedbackText(input);
    for (const part of ['Jan', 'Peeters', 'Marie', 'Dupont', 'Els', 'Janssens']) {
      expect(result).not.toContain(part);
    }
  });

  it('keeps quoted prose that is not a list item', () => {
    expect(scrubFeedbackText('see "Internal error", "Not found"')).toBe(
      'see "Internal error", "Not found"',
    );
  });
});

describe('scrubFeedbackText performance', () => {
  // Inputs are capped at 4000 chars; no pattern may backtrack quadratically or worse.
  const inputs: Record<string, string> = {
    'comma separated quoted run': '"a b", '.repeat(570),
    'long unquoted name values': ('name: ' + 'Jan '.repeat(50) + '\n').repeat(19),
    'digit run': '0'.repeat(4000),
    '00 run': '00' + '1'.repeat(3998),
    '+ run': '+3' + '2'.repeat(3998) + 'x',
    'separated + run': '+32' + ' 1'.repeat(1990) + 'a',
    'dotted 0 run': '0' + '1.'.repeat(1999),
    'email local part without domain': 'a.'.repeat(1990) + '@',
    'base64-like run': 'aA1'.repeat(1333) + '!',
    'unterminated name value': '"name": "' + 'a'.repeat(3990),
    'national id run': '12.34.56-'.repeat(444),
    'capitalised word run': 'Jan '.repeat(1000),
    'capitalised word run after a key': 'name: ' + 'Jan '.repeat(998),
    'capitalised run before an angle bracket': 'Jan van '.repeat(499) + '<',
    'tuple-like run': '[' + '"x", '.repeat(799),
    'bracket zero run': '(0'.repeat(2000),
    'address value run': 'address: ' + 'a, '.repeat(1330),
    'lowercase word run before an angle bracket': 'jan, '.repeat(799) + '<',
    'unterminated unquoted name value': 'name: ' + 'Jan, '.repeat(798),
    'short array-like run': '[1, '.repeat(1000),
    'array of names run': '["Jan Peeters",'.repeat(266),
    'open bracket run': '['.repeat(4000),
    'unbalanced quote run': '["\'a'.repeat(1000),
    'unclosed quotes on many lines': '["a\n'.repeat(1000),
    'escaped single quotes, never closed': '[' + "'\\".repeat(1999),
    'escaped double quotes, never closed': '[' + '"\\'.repeat(1999),
  };

  it.each(Object.entries(inputs))('%s finishes in under 50 ms', (_label, input) => {
    const start = Date.now();
    scrubFeedbackText(input);
    expect(Date.now() - start).toBeLessThan(50);
  });
});
