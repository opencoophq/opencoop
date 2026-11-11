# Sender domain for platform mail

Login codes, magic links, password resets and the other mail sent by
`sendPlatformEmail` normally leave as `Coop name <noreply@opencoop.be>`.
A cooperative can switch that From address to its own domain, for example
`Bronsgroen <noreply@bronsgroen.be>`, after the domain is authenticated in Brevo.

Queued cooperative mail (welcome, dividends, meeting mail) is unchanged. That
path still uses the cooperative's SMTP or Microsoft Graph settings, or the
platform relay with `noreply@opencoop.be`, as before.

## Environment

| Variable                                                        | Where            | Purpose                                                                                                                  |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `BREVO_API_KEY`                                                 | API only         | Brevo REST key used to create a domain, read its DNS records, and ask Brevo to authenticate it.                          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | API, already set | The SMTP relay that actually sends the mail. `SMTP_FROM` stays the platform fallback (`OpenCoop <noreply@opencoop.be>`). |

`BREVO_API_KEY` must belong to the **same Brevo account** as the SMTP relay.
A domain authenticated in another Brevo account (including a cooperative's own
audience-sync key) is not a sender the platform relay will accept.

### What a missing `BREVO_API_KEY` does

The send path never calls the Brevo API. It reads the coop row and decides the
From address from stored state only. So:

- No key: coops with no verified domain send from `noreply@opencoop.be`. Nobody
  can register, check or re-read a domain (`SENDER_DOMAIN_UNAVAILABLE`).
- A coop whose row is already `verified` **with a current DNS proof** keeps
  sending from its own domain, key or no key. That is deliberate: a Brevo or key
  problem must not change where login mail comes from. The nightly recheck then
  runs DNS-only (the proof is still checked and can demote the row).
- A Brevo outage never blocks sending and never demotes a verified row.

The key is never stored on the coop and must not be logged.

### Operator note: passing the variable to the API container

The repository `deploy/docker-compose.yml` passes `BREVO_API_KEY` to the API
service. A host compose file may be older. On each host, **add one line** to the
`api` service `environment:` block (`BREVO_API_KEY: ${BREVO_API_KEY:-}`), and put
the value in that host's `.env`. Edit the existing file in place. Do not replace
a host compose file wholesale: its project name (`name:`) and volume names decide
which database volume is used. Then recreate only the API container with
`docker compose up -d --force-recreate api`. Nothing in this change edits a host.

## Brevo, before the first coop

1. Confirm the platform SMTP user and this API key are the same Brevo account
   (app.brevo.com → SMTP & API).
2. The account must be allowed to add sender domains. No domain is added by
   deploying this change.
3. Do not add a second SPF record on `opencoop.be`. This feature does not
   change the platform domain.

## Rollout

1. Deploy the API and web app with the migrations `20261110190000_sender_domain` and
   `20261110230000_sender_domain_proof`. They only add nullable columns (one with a
   constant default), plus one unique index.
2. Set `BREVO_API_KEY` on the API and recreate the API container. Do not put
   the value in git.
3. Ask one coop admin (Bronsgroen is the natural first) to follow the how-to
   below on acceptance, then production.
4. Send a login code on that coop's login page and confirm the From address.
   The email log row stores `fromAddress`.
5. Other coops opt in themselves. Nothing is switched until their status is
   `verified`.

A nightly read (04:15 Europe/Brussels) re-checks stored domains. If Brevo says
a verified domain is no longer authenticated, status becomes `failed` and mail
falls back to the platform address. A Brevo outage does not demote a verified
domain.

## Ownership proof and races

- **Brevo "verified" is not proof.** It is state of the shared platform account. A domain that
  was added by hand, or released by another coop, shows verified to the next claimant. So a coop
  also has to prove control with a per-coop DNS TXT record before its domain is eligible to send.
- **The proof.** Registering a domain creates a random 128-bit token for that coop. The coop
  publishes `opencoop-sender-verification=<token>` as a TXT record on `_opencoop-challenge.<domain>`.
  The check reads that record with DNS (no Brevo call) and stores `senderDomainProofAt`. The
  token is on the coop's own row only; another coop gets a different token and cannot reuse it.
- **Eligible to send** = stored status `verified` AND `senderDomainProofAt` set AND mailbox on
  that exact domain. Status `verified` needs Brevo `verified` + `authenticated` AND the proof,
  in the manual check and in the nightly recheck. A row with no proof always falls back to the
  platform address.
- **Clear and reclaim.** Clearing deletes the token and the proof. Anyone claiming the domain
  afterwards, including the coop that cleared it, gets a new token and must publish it. Re-registering
  the same domain from the same coop (to change the From address) keeps its token and proof.
- **Lost proof.** The nightly recheck removes the proof and demotes to `failed` when DNS answers
  without the token. A DNS timeout or server failure keeps the stored proof and status.
- **Existing Brevo domains.** A domain already authenticated in the platform account can still be
  registered by its real owner: the owner publishes the TXT and the coop becomes `verified`
  without any extra Brevo step.
- **One coop per domain.** A unique index on `coops.senderDomain` plus a check before any Brevo
  call (`SENDER_DOMAIN_CLAIMED`). A coop holding an unproven domain can block others; a
  SYSTEM_ADMIN can clear it with `DELETE /admin/coops/:coopId/sender-domain`. This is an
  availability issue only: the squatter cannot send as the domain without the DNS proof.
- **Stale results are dropped.** `coops.senderDomainRevision` is bumped by every write to the
  sender-domain fields, including clear on an empty setting. Register, check and the nightly
  recheck save with `WHERE revision = <observed>`, so a slow result cannot land after
  `old -> new -> old`, after a clear, or after a newer register of the same domain. A
  register that lost returns `SENDER_DOMAIN_CHANGED`. No transaction wraps the provider calls.
- **Fallback.** Auth-critical mail retries the platform address when the relay throws or rejects
  the recipient without throwing.
- **Migration locks.** Each `ADD COLUMN` takes a brief `ACCESS EXCLUSIVE` lock on `coops`
  (catalog only, no rewrite, milliseconds on a small table) and queues behind any long
  transaction. The unique index build takes a `SHARE` lock (writes wait, reads continue). These
  are short locks, not zero locks. Run the migration when no long transaction is open.

## How-to for a coop admin

Settings → Email settings → Sender domain.

1. Enter the domain you control (`bronsgroen.be`), the from address
   (`noreply@bronsgroen.be`) and the name members should see (`Bronsgroen`).
   The address must be on that exact domain.
2. Save. OpenCoop registers the domain in the platform Brevo account and shows
   the DNS records. You do not paste an API key.
3. At your DNS host, add:
   - **Ownership proof:** the TXT record shown first (host `_opencoop-challenge`,
     value `opencoop-sender-verification=<your token>`). The token is unique to your
     cooperative. Without it the domain never becomes Verified.
   - **Brevo code:** the TXT record shown (host `@` unless Brevo prints another).
   - **DKIM:** the records Brevo returned. When they are CNAMEs, the hosts are
     `brevo1._domainkey` and `brevo2._domainkey`. Copy the target; do not turn
     it into a URL. If Brevo returns a single TXT instead, publish that record
     exactly.
   - **SPF:** add `include:spf.brevo.com` to the domain's **existing** SPF
     record (the TXT that starts with `v=spf1`). A domain may have only one
     SPF record. A second one breaks both. If there is no SPF record yet, add
     one TXT with the value shown on the page.
   - **DMARC:** add the TXT on `_dmarc` only when the domain does not already
     have one. Leave an existing DMARC record as it is.
4. Press **Check status**. Mail uses your address only when the status is
   **Verified** (Brevo verified and authenticated, and your ownership proof is found). Until then, and if a later
   check fails, members still receive mail from `noreply@opencoop.be` with
   your cooperative's name.
5. Replies go to the cooperative email in Coop information when that address
   is set and is different from the From address.

Login codes, magic links, password resets and email verification are sent
again from `noreply@opencoop.be` if the custom address is refused, so a DNS
mistake cannot lock members out. Other platform mail is not retried.

**Stop using this domain** only clears the setting in OpenCoop. It does not
delete the domain in Brevo. Remove the DNS records yourself when you no longer
want them.

Password-reset mail that is not tied to a cooperative (the account page has no
coop in the link) stays on `noreply@opencoop.be`. A magic link opened from a
coop login page is tied to that coop and can use the verified domain.
