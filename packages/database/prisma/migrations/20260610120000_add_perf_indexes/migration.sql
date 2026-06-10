-- CreateIndex
CREATE INDEX "bank_transactions_coopId_matchStatus_idx" ON "bank_transactions"("coopId", "matchStatus");

-- CreateIndex
CREATE INDEX "dividend_payouts_shareholderId_idx" ON "dividend_payouts"("shareholderId");

-- CreateIndex
CREATE INDEX "email_logs_coopId_idx" ON "email_logs"("coopId");
