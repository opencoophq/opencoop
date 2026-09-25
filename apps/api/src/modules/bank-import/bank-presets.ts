export interface BankPreset {
  id: string;
  name: string;
  delimiter: string;
  encoding: BufferEncoding;
  dateColumn: string;
  dateFormat: string;
  amountColumn: string;
  decimalSeparator: ',' | '.';
  counterpartyColumn: string;
  referenceColumn: string;
  /** For banks where amount sign is in a separate column (e.g. ING "Af Bij") */
  amountSign?: {
    column: string;
    debitValue: string;
    creditValue: string;
  };
}

export const BANK_PRESETS: Record<string, BankPreset> = {
  belfius: {
    id: 'belfius',
    name: 'Belfius',
    delimiter: ';',
    encoding: 'latin1',
    dateColumn: 'Boekingsdatum',
    dateFormat: 'DD/MM/YYYY',
    amountColumn: 'Bedrag',
    decimalSeparator: ',',
    counterpartyColumn: 'Naam tegenpartij bevat',
    referenceColumn: 'Mededelingen',
  },
  kbc: {
    id: 'kbc',
    name: 'KBC',
    delimiter: ';',
    encoding: 'latin1',
    dateColumn: 'Datum',
    dateFormat: 'DD/MM/YYYY',
    amountColumn: 'Bedrag',
    decimalSeparator: ',',
    counterpartyColumn: 'Naam tegenpartij',
    referenceColumn: 'Omschrijving',
  },
  bnp: {
    id: 'bnp',
    name: 'BNP Paribas Fortis',
    delimiter: ';',
    encoding: 'utf-8',
    dateColumn: 'Uitvoeringsdatum',
    dateFormat: 'DD/MM/YYYY',
    amountColumn: 'Bedrag',
    decimalSeparator: ',',
    counterpartyColumn: 'Naam van de tegenpartij',
    referenceColumn: 'Details',
  },
  ing: {
    id: 'ing',
    name: 'ING',
    delimiter: ';',
    encoding: 'utf-8',
    dateColumn: 'Datum',
    dateFormat: 'DD/MM/YYYY',
    amountColumn: 'Bedrag (EUR)',
    decimalSeparator: ',',
    counterpartyColumn: 'Naam / Omschrijving',
    referenceColumn: 'Mededelingen',
    amountSign: {
      column: 'Af Bij',
      debitValue: 'Af',
      creditValue: 'Bij',
    },
  },
  generic: {
    id: 'generic',
    name: 'Generic CSV',
    delimiter: ';',
    encoding: 'utf-8',
    dateColumn: '__col_0',
    dateFormat: 'ISO',
    amountColumn: '__col_1',
    decimalSeparator: ',',
    counterpartyColumn: '__col_2',
    referenceColumn: '__col_3',
  },
};
