import { isCloudflareIp, normalizeIp, parseSingleIp } from './cloudflare-ips';

describe('Cloudflare edge addresses', () => {
  it('recognises the edge ranges that showed up in audit logs', () => {
    expect(isCloudflareIp('172.70.42.10')).toBe(true);
    expect(isCloudflareIp('172.68.0.1')).toBe(true);
    expect(isCloudflareIp('::ffff:172.70.42.10')).toBe(true);
  });

  it('recognises other published v4 and v6 ranges, including the /29', () => {
    expect(isCloudflareIp('104.16.1.1')).toBe(true);
    expect(isCloudflareIp('104.24.1.1')).toBe(true);
    expect(isCloudflareIp('2606:4700:10::1')).toBe(true);
    expect(isCloudflareIp('2a06:98c0::1')).toBe(true);
    expect(isCloudflareIp('2a06:98c7::1')).toBe(true);
  });

  it('rejects the Docker bridge, loopback, and addresses just outside a range', () => {
    expect(isCloudflareIp('172.18.0.2')).toBe(false);
    expect(isCloudflareIp('::ffff:172.18.0.2')).toBe(false);
    expect(isCloudflareIp('127.0.0.1')).toBe(false);
    expect(isCloudflareIp('8.8.8.8')).toBe(false);
    expect(isCloudflareIp('172.63.255.255')).toBe(false);
    expect(isCloudflareIp('172.72.0.1')).toBe(false);
    expect(isCloudflareIp('2a06:98c8::1')).toBe(false);
    expect(isCloudflareIp('2606:4701::1')).toBe(false);
    expect(isCloudflareIp(undefined)).toBe(false);
    expect(isCloudflareIp('not-an-ip')).toBe(false);
  });

  it('normalises IPv4-mapped addresses and parses a single visitor IP', () => {
    expect(normalizeIp('::ffff:203.0.113.8')).toBe('203.0.113.8');
    expect(parseSingleIp('203.0.113.8')).toBe('203.0.113.8');
    expect(parseSingleIp('::ffff:203.0.113.8')).toBe('203.0.113.8');
    expect(parseSingleIp('2001:DB8::1')).toBe('2001:db8::1');
    expect(parseSingleIp('203.0.113.8, 172.70.1.1')).toBeNull();
    expect(parseSingleIp('203.0.113.8 172.70.1.1')).toBeNull();
    expect(parseSingleIp(['203.0.113.8'])).toBeNull();
    expect(parseSingleIp('172.070.1.1')).toBeNull();
    expect(parseSingleIp(undefined)).toBeNull();
  });
});
