import { Logger } from '@nestjs/common';
import {
  BrevoList,
  EmailAudienceProvider,
  UpsertContactInput,
  UpsertResult,
} from './audience-provider.interface';
import { AudienceProviderError, mapBrevoHttpError } from './audience-sync.errors';
import { normalizeEmail } from './audience-sync.grouping';

const BASE = 'https://api.brevo.com/v3';

export class BrevoProvider implements EmailAudienceProvider {
  private readonly logger = new Logger(BrevoProvider.name);

  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'api-key': this.apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  async verifyConnection(): Promise<{ ok: boolean; detail?: string }> {
    const res = await fetch(`${BASE}/account`, { method: 'GET', headers: this.headers() });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, detail: `${res.status}: ${body}` };
  }

  async listLists(): Promise<BrevoList[]> {
    const res = await fetch(`${BASE}/contacts/lists?limit=50&offset=0`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Brevo listLists failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { lists?: Array<{ id: number; name: string }> };
    return (json.lists ?? []).map((l) => ({ id: String(l.id), name: l.name }));
  }

  async upsertContact(input: UpsertContactInput): Promise<UpsertResult> {
    // 1) Address the existing contact by EXT_ID (handles email changes, no duplicates).
    // Contacts are never deleted. Unlink is list membership only.
    const putBody: Record<string, unknown> = {
      attributes: input.attributes,
      listIds: input.addListIds,
      unlinkListIds: input.removeListIds,
    };
    if (input.email) putBody.email = input.email;
    // NOTE: never set emailBlacklisted — preserve Brevo's unsubscribe state.
    // NOTE: never set forceMerge — that deletes the other contact.

    const putRes = await fetch(
      `${BASE}/contacts/${encodeURIComponent(input.extId)}?identifierType=ext_id`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify(putBody) },
    );
    if (putRes.ok) return 'updated';

    if (putRes.status === 404) {
      if (!input.createIfMissing) return 'noop';
      if (!input.email) {
        throw new AudienceProviderError('MISSING_EMAIL');
      }
      // 2) Create (or match-by-email and set ext_id) for active members.
      const postBody = {
        email: input.email,
        ext_id: input.extId,
        attributes: input.attributes,
        listIds: input.addListIds,
        updateEnabled: true,
      };
      const postRes = await fetch(`${BASE}/contacts`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(postBody),
      });
      if (postRes.ok) return 'created';
      const postError = await this.errorFrom(postRes);
      if (postError.code === 'DUPLICATE_EMAIL') {
        const claimed = await this.claimExistingEmail(input);
        if (claimed) return 'updated';
      }
      throw postError;
    }

    throw await this.errorFrom(putRes);
  }

  /**
   * The email already belongs to another contact. If that contact is one of
   * the shareholder EXT_IDs we are allowed to claim, point it at the primary
   * EXT_ID. This does not delete anyone (no forceMerge).
   */
  private async claimExistingEmail(input: UpsertContactInput): Promise<boolean> {
    const wanted = normalizeEmail(input.email);
    if (!wanted) return false;

    for (const fromExtId of input.claimFromExtIds ?? []) {
      if (fromExtId === input.extId) continue;
      const existing = await this.readContactEmail(fromExtId);
      if (!existing || normalizeEmail(existing) !== wanted) continue;

      const res = await fetch(
        `${BASE}/contacts/${encodeURIComponent(fromExtId)}?identifierType=ext_id`,
        {
          method: 'PUT',
          headers: this.headers(),
          body: JSON.stringify({
            ext_id: input.extId,
            attributes: input.attributes,
            listIds: input.addListIds,
            unlinkListIds: input.removeListIds,
          }),
        },
      );
      if (res.ok) return true;
      throw await this.errorFrom(res);
    }
    return false;
  }

  private async readContactEmail(extId: string): Promise<string | null | undefined> {
    const res = await fetch(`${BASE}/contacts/${encodeURIComponent(extId)}?identifierType=ext_id`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw await this.errorFrom(res);
    const json = (await res.json()) as { email?: string | null };
    return json.email ?? null;
  }

  private async errorFrom(res: Response): Promise<AudienceProviderError> {
    const body = await res.text();
    const error = mapBrevoHttpError(res.status, body);
    this.logger.warn(`Brevo contact call failed status=${res.status} code=${error.code}`);
    return error;
  }
}
