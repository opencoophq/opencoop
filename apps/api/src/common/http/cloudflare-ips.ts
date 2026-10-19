/**
 * Cloudflare edge ranges, snapshotted 2026-10-19 from
 * https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
 * Refresh when Cloudflare announces a range change — a stale list makes
 * `req.ip` fall back to the edge address instead of CF-Connecting-IP.
 */
export const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

export const CLOUDFLARE_IPV6_CIDRS = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Strip a single IPv4-mapped prefix so `::ffff:172.70.1.1` compares as IPv4. */
export function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith('::ffff:')) {
    const rest = trimmed.slice('::ffff:'.length);
    if (ipv4ToInt(rest) !== null) return rest;
  }
  return trimmed;
}

export function isCloudflareIp(ip: string | undefined | null): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (ipv4ToInt(normalized) !== null) {
    return CLOUDFLARE_IPV4_CIDRS.some((cidr) => inCidrV4(normalized, cidr));
  }
  const groups = expandIpv6(normalized);
  if (!groups) return false;
  if (isIpv4Mapped(groups)) {
    return isCloudflareIp(ipv4FromMapped(groups));
  }
  return CLOUDFLARE_IPV6_CIDRS.some((cidr) => inCidrV6(groups, cidr));
}

/**
 * A single IP suitable for writing into X-Forwarded-For.
 * Rejects lists, whitespace, and anything that is not one address — those
 * are how a client would smuggle a second hop into the header.
 */
export function parseSingleIp(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /[\s,]/.test(trimmed)) return null;
  if (ipv4ToInt(trimmed) !== null) return trimmed;
  const mapped = normalizeIp(trimmed);
  if (mapped && mapped !== trimmed && ipv4ToInt(mapped) !== null) return mapped;
  if (!expandIpv6(trimmed)) return null;
  return trimmed.toLowerCase();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function expandIpv6(ip: string): number[] | null {
  const zone = ip.indexOf('%');
  let value = zone === -1 ? ip : ip.slice(0, zone);
  if (!value) return null;

  let v4Tail: [number, number] | null = null;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon === -1) return null;
    const v4 = ipv4ToInt(value.slice(lastColon + 1));
    if (v4 === null) return null;
    v4Tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    value = value.slice(0, lastColon);
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const nums: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      nums.push(parseInt(group, 16));
    }
    return nums;
  };

  const left = parseGroups(halves[0]);
  const right = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!left || !right) return null;
  const width = v4Tail ? 6 : 8;
  if (halves.length === 1 && left.length !== width) return null;
  const missing = width - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill(0), ...right];
  if (groups.length !== width) return null;
  return v4Tail ? [...groups, ...v4Tail] : groups;
}

function isIpv4Mapped(groups: number[]): boolean {
  return (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  );
}

function ipv4FromMapped(groups: number[]): string {
  return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
}

function inCidrV6(groups: number[], cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  const base = expandIpv6(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  if (!base || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  let remaining = bits;
  for (let i = 0; i < 8; i++) {
    if (remaining <= 0) return true;
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((groups[i] & mask) !== (base[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}
