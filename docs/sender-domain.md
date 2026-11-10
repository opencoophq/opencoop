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

Leave `BREVO_API_KEY` empty until you are ready. Sending keeps working: every
coop stays on `noreply@opencoop.be`. The key is never stored on the coop and
must not be logged.

## Brevo, before the first coop

1. Confirm the platform SMTP user and this API key are the same Brevo account
   (app.brevo.com → SMTP & API).
2. The account must be allowed to add sender domains. No domain is added by
   deploying this change.
3. Do not add a second SPF record on `opencoop.be`. This feature does not
   change the platform domain.

## Rollout

1. Deploy the API and web app with the migration `20261110190000_sender_domain`.
   The migration only adds nullable columns.
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

## How-to for a coop admin

Settings → Email settings → Sender domain.

1. Enter the domain you control (`bronsgroen.be`), the from address
   (`noreply@bronsgroen.be`) and the name members should see (`Bronsgroen`).
   The address must be on that exact domain.
2. Save. OpenCoop registers the domain in the platform Brevo account and shows
   the DNS records. You do not paste an API key.
3. At your DNS host, add:
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
   **Verified** (Brevo verified and authenticated). Until then, and if a later
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
