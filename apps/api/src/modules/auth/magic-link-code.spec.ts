jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    timingSafeEqual: jest.fn(actual.timingSafeEqual),
    randomInt: jest.fn(() => 42),
  };
});

import * as crypto from 'crypto';
import {
  codesMatch,
  generateCodeSalt,
  generateLoginCode,
  hashLoginCode,
  normalizeLoginCode,
} from './magic-link-code';

describe('magic-link code', () => {
  it('pads a 6-digit code and keeps leading zeros', () => {
    expect(generateLoginCode()).toBe('000042');
    expect(crypto.randomInt).toHaveBeenCalledWith(0, 1_000_000);
  });

  it('strips spaces, including the ones letter-spacing inserts when copying', () => {
    expect(normalizeLoginCode('123 456')).toBe('123456');
    expect(normalizeLoginCode('12 34 56')).toBe('123456');
    expect(normalizeLoginCode(' 123456 ')).toBe('123456');
    expect(normalizeLoginCode('123\n456')).toBe('123456');
  });

  it('stores a salted hash, not the code, and compares it in constant time', () => {
    const saltA = generateCodeSalt();
    const saltB = generateCodeSalt();
    const code = '482913';
    const hashA = hashLoginCode(code, saltA).toString('hex');
    const hashB = hashLoginCode(code, saltB).toString('hex');

    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    expect(hashA).not.toBe(code);
    expect(hashA).not.toBe(hashB);
    expect(codesMatch('482 913', saltA, hashA)).toBe(true);
    expect(codesMatch('000000', saltA, hashA)).toBe(false);
    expect(codesMatch(code, saltA, 'not-a-hash')).toBe(false);
    expect(crypto.timingSafeEqual).toHaveBeenCalled();
  });
});
