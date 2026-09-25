-- Bank rows that are not share payments (supplier invoices, salaries, bank fees,
-- outgoing transfers) are kept for audit and dedupe but leave the unmatched list.
ALTER TYPE "BankTransactionMatchStatus" ADD VALUE 'IGNORED';
