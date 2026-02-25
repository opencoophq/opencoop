/**
 * Format a number as currency (EUR by default)
 */
export function formatCurrency(amount: number, locale = 'nl-BE', currency = 'EUR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Calculate dividend amounts (gross, tax, net)
 */
export function calculateDividend(
  shareValue: number,
  dividendRate: number,
  withholdingTaxRate: number,
): { gross: number; tax: number; net: number } {
  const gross = shareValue * dividendRate;
  const tax = gross * withholdingTaxRate;
  const net = gross - tax;
  return {
    gross: Math.round(gross * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    net: Math.round(net * 100) / 100,
  };
}

/**
 * Generate a Belgian OGM (gestructureerde mededeling) code.
 * Format: +++XXX/XXXX/XXXXX+++
 * The last 2 digits are a modulo 97 check digit.
 *
 * @param prefix - 3-digit coop prefix (e.g., "001")
 * @param sequence - sequence number (auto-padded to 7 digits)
 */
export function generateOgmCode(prefix: string, sequence: number): string {
  // Combine prefix (3 digits) + sequence (7 digits) = 10 digits
  const base = prefix + sequence.toString().padStart(7, '0');

  // Calculate modulo 97 check digit
  const num = BigInt(base);
  let checkDigit = Number(num % BigInt(97));
  if (checkDigit === 0) checkDigit = 97;

  const full = base + checkDigit.toString().padStart(2, '0');

  // Format as +++XXX/XXXX/XXXXX+++
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7)}+++`;
}

/**
 * Validate a Belgian OGM code.
 */
export function validateOgmCode(ogm: string): boolean {
  // Remove formatting
  const cleaned = ogm.replace(/[+/\s]/g, '');

  if (cleaned.length !== 12) return false;
  if (!/^\d{12}$/.test(cleaned)) return false;

  const base = cleaned.slice(0, 10);
  const checkDigit = parseInt(cleaned.slice(10), 10);

  const num = BigInt(base);
  let expected = Number(num % BigInt(97));
  if (expected === 0) expected = 97;

  return checkDigit === expected;
}

/**
 * Format a raw 12-digit OGM code into the Belgian structured communication format.
 * Input: "123456789012" -> Output: "+++123/4567/89012+++"
 */
export function formatOgmCode(raw: string): string {
  const cleaned = raw.replace(/[+/\s]/g, '');
  if (cleaned.length !== 12) return raw;
  return `+++${cleaned.slice(0, 3)}/${cleaned.slice(3, 7)}/${cleaned.slice(7)}+++`;
}

/**
 * Parse a formatted OGM code back to raw digits.
 */
export function parseOgmCode(formatted: string): string {
  return formatted.replace(/[+/\s]/g, '');
}

/**
 * Format a Belgian national ID (rijksregisternummer).
 * Input: "90020112345" -> Output: "90.02.01-123.45"
 */
export function formatNationalId(id: string): string {
  const cleaned = id.replace(/[\s.-]/g, '');
  if (cleaned.length !== 11) return id;
  return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 4)}.${cleaned.slice(4, 6)}-${cleaned.slice(6, 9)}.${cleaned.slice(9)}`;
}

/**
 * Validate a Belgian national ID (rijksregisternummer).
 * Uses modulo 97 check.
 */
export function validateNationalId(id: string): boolean {
  const cleaned = id.replace(/[\s.-]/g, '');
  if (cleaned.length !== 11) return false;
  if (!/^\d{11}$/.test(cleaned)) return false;

  const checkDigit = parseInt(cleaned.slice(9), 10);

  // Try both with and without 2000 prefix
  const base = parseInt(cleaned.slice(0, 9), 10);
  const check1 = 97 - (base % 97);

  if (check1 === checkDigit) return true;

  // For people born in 2000+, prefix with 2
  const base2000 = parseInt('2' + cleaned.slice(0, 9), 10);
  const check2 = 97 - (base2000 % 97);

  return check2 === checkDigit;
}

/**
 * Format a Belgian VAT number.
 * Input: "0123456789" -> Output: "BE 0123.456.789"
 */
export function formatVatNumber(vat: string): string {
  const cleaned = vat.replace(/[\s.BE]/g, '');
  if (cleaned.length !== 10) return vat;
  return `BE ${cleaned.slice(0, 4)}.${cleaned.slice(4, 7)}.${cleaned.slice(7)}`;
}

/**
 * Validate a Belgian VAT number (basic format check).
 */
export function validateVatNumber(vat: string): boolean {
  const cleaned = vat.replace(/[\s.BE]/g, '');
  if (cleaned.length !== 10) return false;
  if (!/^\d{10}$/.test(cleaned)) return false;
  // First digit must be 0 or 1
  return cleaned[0] === '0' || cleaned[0] === '1';
}

/**
 * Format an IBAN for display.
 * Input: "BE68539007547034" -> Output: "BE68 5390 0754 7034"
 */
export function formatIban(iban: string): string {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  return cleaned.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Validate an IBAN using ISO 7064 Mod 97-10 checksum.
 * Supports any country IBAN format.
 */
export function validateIban(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();

  // Basic format check: 2 letters + 2 digits + up to 30 alphanumeric
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(cleaned)) return false;

  // Move first 4 chars to end and convert letters to numbers (A=10, B=11, ...)
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (ch) =>
    (ch.charCodeAt(0) - 55).toString(),
  );

  // Mod 97 check (process in chunks to avoid BigInt for portability)
  let remainder = numeric;
  while (remainder.length > 2) {
    const block = remainder.slice(0, 9);
    remainder = (parseInt(block, 10) % 97).toString() + remainder.slice(block.length);
  }

  return parseInt(remainder, 10) % 97 === 1;
}

/**
 * Generate an EPC QR code payload (European Payments Council, version 002).
 * This creates the text content for a SEPA Credit Transfer QR code.
 *
 * @param params - Payment parameters
 * @returns Multi-line string to encode in a QR code
 */
export function generateEpcQrPayload(params: {
  bic: string;
  beneficiaryName: string;
  iban: string;
  amount: number;
  reference?: string;       // Structured reference (OGM)
  unstructured?: string;    // Unstructured remittance info
}): string {
  const lines = [
    'BCD',                                        // Service tag
    '002',                                        // Version
    '1',                                          // Character set (UTF-8)
    'SCT',                                        // Identification code (SEPA Credit Transfer)
    params.bic.replace(/\s/g, '').toUpperCase(),  // BIC
    params.beneficiaryName.slice(0, 70),          // Beneficiary name (max 70 chars)
    params.iban.replace(/\s/g, '').toUpperCase(), // IBAN
    `EUR${params.amount.toFixed(2)}`,             // Amount
    '',                                           // Purpose (empty)
    params.reference || '',                       // Structured reference
    params.unstructured || '',                    // Unstructured remittance info
  ];

  return lines.join('\n');
}
