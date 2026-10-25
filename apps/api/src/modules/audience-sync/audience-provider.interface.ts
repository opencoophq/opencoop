export interface BrevoList {
  id: string;
  name: string;
}

/** Values Brevo accepts on a contact attribute. Null clears nothing by itself; callers omit keys they do not want to send. */
export type ContactAttributeValue = string | number | boolean | null;

export interface UpsertContactInput {
  /** OpenCoop shareholder id — stored as Brevo EXT_ID, the stable identity. */
  extId: string;
  /** Resolved email; null is allowed only when createIfMissing is false. */
  email: string | null;
  /**
   * Contact attributes. FIRSTNAME and LASTNAME stay the name fields.
   * Callers may add any other attribute the Brevo account already defines
   * (for example COOPERANT and STATUS). Unknown names are a 400 from Brevo.
   */
  attributes: Record<string, ContactAttributeValue>;
  addListIds: number[];
  removeListIds: number[];
  /** Active members may be created if absent; resigned contacts must not be. */
  createIfMissing: boolean;
  /**
   * When create hits duplicate_parameter and the primary contact does not exist
   * yet, reassign EXT_ID from one of these ids. That call never includes email.
   * If the primary contact already exists, the sync fails with GROUP_EMAIL_CONFLICT.
   */
  claimFromExtIds?: string[];
}

export type UpsertResult = 'created' | 'updated' | 'noop';

/** Provider-agnostic seam. Knows nothing about shareholders or coops. */
export interface EmailAudienceProvider {
  /**
   * Account check. `ok` is the connection. A missing COOPERANT/STATUS attribute
   * is `warning`, not a failed connection. The sync does not create attributes.
   */
  verifyConnection(): Promise<{ ok: boolean; detail?: string; warning?: string }>;
  /**
   * Contact attribute definitions. Implementations may cache this briefly so a
   * burst of reconcile-one calls does not refetch.
   */
  listContactAttributes(): Promise<Array<{ name?: string; type?: string }>>;
  listLists(): Promise<BrevoList[]>;
  /** Idempotent upsert addressed by EXT_ID; never sets emailBlacklisted. */
  upsertContact(input: UpsertContactInput): Promise<UpsertResult>;
}
