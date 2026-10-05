/**
 * A blank or malformed fee/VAT field must not silently fall back to the old
 * server value: `toOptionalNumber` turns an unparseable string into
 * `undefined`, and the settings PUT drops `undefined` fields rather than
 * clearing them, so a bad edit would report success while nothing changed.
 * Caught here before the request, mirroring the server's own check
 * (`update-coop.dto.ts`: positive, at most 2 decimals; VAT additionally
 * capped at 100).
 */
export function isValidAmount(value: string, { min = 0.01, max }: { min?: number; max?: number } = {}): boolean {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return false;
  const parsed = Number(trimmed);
  if (parsed < min) return false;
  if (max !== undefined && parsed > max) return false;
  return true;
}

/**
 * A 403 (admin without `canManageShareholders`) or 404 (route not reachable)
 * from the charge-cards list means "no cards for this admin/coop right now",
 * not a failure — the match dialog should show it the same as an empty
 * list. Any other status (500, network error, etc.) is a real failure and
 * must surface as an inline error instead of the card list silently
 * vanishing with no explanation.
 */
export function isSilentChargeCardsLoadFailure(status: number | undefined): boolean {
  return status === 403 || status === 404;
}
