/**
 * Brevo sender-domain API (POST/GET /v3/senders/domains, PUT .../authenticate).
 *
 * The API key is read by the caller from BREVO_API_KEY and passed in. It is
 * never written to an error, a log line, or a stored DNS record.
 */

import { BREVO_DMARC_VALUE, BREVO_SPF_INCLUDE, BREVO_SPF_NEW_RECORD } from './sender-domain';

const BASE = 'https://api.brevo.com/v3';

export type SenderDnsKey = 'brevo-code' | 'dkim' | 'spf' | 'dmarc';

export interface SenderDnsRecord {
  key: SenderDnsKey;
  type: string;
  host: string;
  value: string;
  status: boolean | null;
  /** SPF: this include must be merged into the single existing SPF TXT. */
  merge?: boolean;
  /** SPF value to publish only when the domain has no SPF record yet. */
  newRecordValue?: string;
  /** DMARC: add only when the domain has no _dmarc TXT yet. */
  ifMissing?: boolean;
}

export interface BrevoDomainSnapshot {
  domain: string;
  verified: boolean;
  authenticated: boolean;
  records: SenderDnsRecord[];
}

export class BrevoDomainRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BrevoDomainRequestError';
  }
}

type FetchImpl = typeof fetch;

export async function createBrevoDomain(
  apiKey: string,
  domain: string,
  fetchImpl: FetchImpl = fetch,
): Promise<BrevoDomainSnapshot | null> {
  const res = await request(apiKey, '/senders/domains', fetchImpl, {
    method: 'POST',
    body: JSON.stringify({ name: domain }),
  });
  const body = await res.text();
  if (res.ok) return parseMaybeSnapshot(body, domain);
  if (isAlreadyExists(res.status, body)) return null;
  throw new BrevoDomainRequestError(res.status, publicBrevoMessage(res.status, body, apiKey));
}

export async function getBrevoDomain(
  apiKey: string,
  domain: string,
  fetchImpl: FetchImpl = fetch,
): Promise<BrevoDomainSnapshot> {
  const res = await request(apiKey, `/senders/domains/${encodeURIComponent(domain)}`, fetchImpl, {
    method: 'GET',
  });
  const body = await res.text();
  if (!res.ok) {
    throw new BrevoDomainRequestError(res.status, publicBrevoMessage(res.status, body, apiKey));
  }
  const snapshot = parseMaybeSnapshot(body, domain);
  if (!snapshot) {
    throw new BrevoDomainRequestError(res.status, publicBrevoMessage(res.status, '', apiKey));
  }
  return snapshot;
}

/**
 * Asks Brevo to check DNS. HTTP 400 means the records are not valid yet,
 * which is a normal outcome, not a transport failure.
 */
export async function authenticateBrevoDomain(
  apiKey: string,
  domain: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; missing: boolean }> {
  const res = await request(
    apiKey,
    `/senders/domains/${encodeURIComponent(domain)}/authenticate`,
    fetchImpl,
    { method: 'PUT' },
  );
  const body = await res.text();
  if (res.ok) return { ok: true, missing: false };
  if (res.status === 400) return { ok: false, missing: false };
  if (res.status === 404) return { ok: false, missing: true };
  throw new BrevoDomainRequestError(res.status, publicBrevoMessage(res.status, body, apiKey));
}

export function parseBrevoDomainPayload(
  json: unknown,
  fallbackDomain: string,
): BrevoDomainSnapshot {
  const root = asRecord(json) ?? {};
  const domain = readString(root.domain) || readString(root.domain_name) || fallbackDomain;
  const dns = asRecord(root.dns_records) ?? asRecord(root.dnsRecords) ?? {};
  const records = normalizeDnsRecords(dns, domain);
  return {
    domain,
    verified: root.verified === true,
    authenticated: root.authenticated === true,
    records,
  };
}

export function normalizeDnsRecords(
  dns: Record<string, unknown>,
  domain: string,
): SenderDnsRecord[] {
  const records: SenderDnsRecord[] = [];
  const code = readDnsRecord(dns.brevo_code ?? dns.brevoCode);
  if (code) {
    records.push({
      key: 'brevo-code',
      type: code.type || 'TXT',
      host: displayHost(code.host, domain),
      value: code.value,
      status: code.status,
    });
  }

  const dkimRaw = [
    dns.dkim1Record,
    dns.dkim1_record,
    dns.dkim2Record,
    dns.dkim2_record,
    dns.dkim_record,
    dns.dkimRecord,
  ];
  const seen = new Set<string>();
  const dkim: SenderDnsRecord[] = [];
  for (const raw of dkimRaw) {
    const record = readDnsRecord(raw);
    if (!record) continue;
    const host = displayHost(record.host, domain);
    const fingerprint = `${record.type}|${host}|${record.value}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    dkim.push({
      key: 'dkim',
      type: record.type || 'CNAME',
      host,
      value: record.value,
      status: record.status,
    });
  }
  dkim.sort((a, b) => dkimOrder(a.host) - dkimOrder(b.host));
  records.push(...dkim);

  records.push({
    key: 'spf',
    type: 'TXT',
    host: '@',
    value: BREVO_SPF_INCLUDE,
    status: null,
    merge: true,
    newRecordValue: BREVO_SPF_NEW_RECORD,
  });

  const dmarc = readDnsRecord(dns.dmarc_record ?? dns.dmarcRecord);
  records.push({
    key: 'dmarc',
    type: dmarc?.type || 'TXT',
    host: dmarc ? displayHost(dmarc.host, domain) : '_dmarc',
    value: dmarc?.value || BREVO_DMARC_VALUE,
    status: dmarc?.status ?? null,
    ifMissing: true,
  });

  return records;
}

function dkimOrder(host: string): number {
  if (host.includes('brevo1')) return 1;
  if (host.includes('brevo2')) return 2;
  return 9;
}

async function request(
  apiKey: string,
  path: string,
  fetchImpl: FetchImpl,
  init: { method: string; body?: string },
): Promise<Response> {
  return fetchImpl(`${BASE}${path}`, {
    method: init.method,
    headers: {
      'api-key': apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: init.body,
    signal: AbortSignal.timeout(15_000),
  });
}

function parseMaybeSnapshot(body: string, fallbackDomain: string): BrevoDomainSnapshot | null {
  if (!body.trim()) return null;
  try {
    return parseBrevoDomainPayload(JSON.parse(body) as unknown, fallbackDomain);
  } catch {
    return null;
  }
}

function isAlreadyExists(status: number, body: string): boolean {
  if (status !== 400 && status !== 409) return false;
  return /already|exist|duplicate/i.test(body);
}

/** Status plus a short body, with the API key and Brevo key prefixes removed. */
export function publicBrevoMessage(status: number, body: string, apiKey: string): string {
  let text = body;
  if (apiKey) {
    text = text.split(apiKey).join('[redacted]');
  }
  text = text.replace(/xkeysib-[a-z0-9-]+/gi, '[redacted]');
  text = text
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 300);
  return text
    ? `Brevo domain request failed (${status}): ${text}`
    : `Brevo domain request failed (${status})`;
}

function readDnsRecord(
  raw: unknown,
): { type: string; host: string; value: string; status: boolean | null } | null {
  const record = asRecord(raw);
  if (!record) return null;
  const value = readString(record.value);
  if (!value) return null;
  const status = typeof record.status === 'boolean' ? record.status : null;
  return {
    type: (readString(record.type) || 'TXT').toUpperCase(),
    host:
      readString(record.host_name) || readString(record.hostName) || readString(record.host) || '',
    value,
    status,
  };
}

function displayHost(host: string, domain: string): string {
  let value = host.trim().replace(/\.$/, '');
  if (!value || value === '@' || value.toLowerCase() === domain.toLowerCase()) return '@';
  const suffix = `.${domain.toLowerCase()}`;
  if (value.toLowerCase().endsWith(suffix)) {
    value = value.slice(0, value.length - suffix.length);
  }
  return value || '@';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
