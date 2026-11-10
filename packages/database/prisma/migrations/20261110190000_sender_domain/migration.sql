-- Per-coop sender domain for platform mail (sendPlatformEmail), plus the
-- mailbox that was actually submitted on each email_logs row.
--
-- Additive and safe on PostgreSQL 16:
--   * Every new column is nullable, with no default and no backfill.
--     Existing coops and email_logs rows are left unchanged. ADD COLUMN of a
--     nullable column without a default is a catalog change; it does not
--     rewrite the table.
--   * No enum values, no drops, no rewrites of SMTP credentials or mail bodies.
--   * senderDomainRecords holds the DNS instructions Brevo returned (and the
--     static SPF/DMARC guidance). It is not a secret. The Brevo API key stays
--     in the BREVO_API_KEY environment variable and is not stored here.

ALTER TABLE "coops" ADD COLUMN "senderDomain" TEXT;
ALTER TABLE "coops" ADD COLUMN "senderFromAddress" TEXT;
ALTER TABLE "coops" ADD COLUMN "senderFromName" TEXT;
ALTER TABLE "coops" ADD COLUMN "senderDomainStatus" TEXT;
ALTER TABLE "coops" ADD COLUMN "senderDomainCheckedAt" TIMESTAMP(3);
ALTER TABLE "coops" ADD COLUMN "senderDomainRecords" JSONB;
ALTER TABLE "coops" ADD COLUMN "senderDomainError" TEXT;

ALTER TABLE "email_logs" ADD COLUMN "fromAddress" TEXT;
