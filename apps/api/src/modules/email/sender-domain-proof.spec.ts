import { lookupProof, newProofToken, proofHost, proofValue } from './sender-domain-proof';

const dnsError = (code: string) => Object.assign(new Error(`queryTxt ${code}`), { code });

describe('sender domain DNS proof', () => {
  it('builds a per-token TXT value on a fixed challenge host', () => {
    expect(proofHost('bronsgroen.be')).toBe('_opencoop-challenge.bronsgroen.be');
    expect(proofValue('abc')).toBe('opencoop-sender-verification=abc');
  });

  it('creates a different 128-bit token every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newProofToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is ok only when the exact token is published, including split TXT chunks', async () => {
    const resolve = jest
      .fn()
      .mockResolvedValue([['v=spf1 -all'], ['opencoop-sender-verif', 'ication=tok-a']]);
    await expect(lookupProof('bronsgroen.be', 'tok-a', resolve)).resolves.toBe('ok');
    expect(resolve).toHaveBeenCalledWith('_opencoop-challenge.bronsgroen.be');
  });

  it("does not accept another coop's token or a partial match", async () => {
    const resolve = jest
      .fn()
      .mockResolvedValue([
        ['opencoop-sender-verification=tok-b'],
        ['opencoop-sender-verification=tok-a-extra'],
      ]);
    await expect(lookupProof('bronsgroen.be', 'tok-a', resolve)).resolves.toBe('absent');
  });

  it('treats NXDOMAIN and no-data as absent', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      const resolve = jest.fn().mockRejectedValue(dnsError(code));
      await expect(lookupProof('bronsgroen.be', 'tok-a', resolve)).resolves.toBe('absent');
    }
  });

  it('treats timeouts and server failures as an error, not as absent', async () => {
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED']) {
      const resolve = jest.fn().mockRejectedValue(dnsError(code));
      await expect(lookupProof('bronsgroen.be', 'tok-a', resolve)).resolves.toBe('error');
    }
    await expect(
      lookupProof('bronsgroen.be', 'tok-a', jest.fn().mockRejectedValue(new Error('x'))),
    ).resolves.toBe('error');
  });

  it('is absent without a token and does not query DNS', async () => {
    const resolve = jest.fn();
    await expect(lookupProof('bronsgroen.be', null, resolve)).resolves.toBe('absent');
    expect(resolve).not.toHaveBeenCalled();
  });
});
