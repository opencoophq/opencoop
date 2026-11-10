/**
 * Tenant-bound proof that a coop controls its sender domain.
 *
 * Brevo "verified + authenticated" belongs to the shared platform account.
 * It says the domain is set up for the platform, not that THIS coop owns it.
 * So each registration gets a random token, and the coop must publish it as a
 * TXT record. The token lives only on that coop's row and is dropped when the
 * coop clears the domain. Another coop gets its own token and must publish it.
 */

import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { Injectable } from '@nestjs/common';

export const PROOF_HOST_LABEL = '_opencoop-challenge';
const PROOF_PREFIX = 'opencoop-sender-verification=';

/** ok: token found. absent: DNS answered and the token is not there. error: no answer. */
export type ProofResult = 'ok' | 'absent' | 'error';

export type TxtResolver = (host: string) => Promise<string[][]>;

export function newProofToken(): string {
  return randomBytes(16).toString('hex');
}

export function proofValue(token: string): string {
  return `${PROOF_PREFIX}${token}`;
}

export function proofHost(domain: string): string {
  return `${PROOF_HOST_LABEL}.${domain}`;
}

const ABSENT_CODES = new Set(['ENODATA', 'ENOTFOUND']);

export async function lookupProof(
  domain: string,
  token: string | null | undefined,
  resolveTxt: TxtResolver,
): Promise<ProofResult> {
  // No token means nothing can have been published for this coop.
  if (!token) return 'absent';
  let answers: string[][];
  try {
    answers = await resolveTxt(proofHost(domain));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && ABSENT_CODES.has(code) ? 'absent' : 'error';
  }
  const wanted = proofValue(token);
  const found = answers.some((chunks) => chunks.join('').trim() === wanted);
  return found ? 'ok' : 'absent';
}

@Injectable()
export class SenderDomainProofChecker {
  private readonly resolver = new Resolver({ timeout: 4000, tries: 2 });

  check(domain: string, token: string | null | undefined): Promise<ProofResult> {
    return lookupProof(domain, token, (host) => this.resolver.resolveTxt(host));
  }
}
