import { decodeJwtPayload } from './jwt-payload';

function encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

describe('decodeJwtPayload', () => {
  it('decodes a payload that needs padding', () => {
    const token = `h.${encode({ a: 'x' })}.s`;
    expect(decodeJwtPayload(token)).toEqual({ a: 'x' });
  });

  it('decodes a payload containing base64url - and _ characters', () => {
    const payload = { name: '???>>>~~~', note: 'é 100%' };
    const segment = encode(payload);
    expect(segment).toMatch(/[-_]/);
    expect(decodeJwtPayload(`h.${segment}.s`)).toEqual(payload);
  });

  it('throws on a token without a payload segment', () => {
    expect(() => decodeJwtPayload('abc')).toThrow();
  });
});
