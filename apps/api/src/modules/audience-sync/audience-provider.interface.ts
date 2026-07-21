export interface BrevoList {
  id: string;
  name: string;
}

export interface UpsertContactInput {
  /** OpenCoop shareholder id — stored as Brevo EXT_ID, the stable identity. */
  extId: string;
  /** Resolved email; null is allowed only when createIfMissing is false. */
  email: string | null;
  attributes: { FIRSTNAME?: string; LASTNAME?: string };
  addListIds: number[];
  removeListIds: number[];
  /** Active members may be created if absent; resigned contacts must not be. */
  createIfMissing: boolean;
}

export type UpsertResult = 'created' | 'updated' | 'noop';

/** Provider-agnostic seam. Knows nothing about shareholders or coops. */
export interface EmailAudienceProvider {
  verifyConnection(): Promise<{ ok: boolean; detail?: string }>;
  listLists(): Promise<BrevoList[]>;
  /** Idempotent upsert addressed by EXT_ID; never sets emailBlacklisted. */
  upsertContact(input: UpsertContactInput): Promise<UpsertResult>;
}
