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
    // Contacts are never deleted. Unlink is list membership only.
    // NOTE: never set emailBlacklisted — preserve Brevo's unsubscribe state.
    // NOTE: never set forceMerge — that deletes the other contact.
    const putBody = this.contactBody(input);

    const putRes = await this.putContact(input.extId, putBody);
    if (putRes.ok) return 'updated';

    if (putRes.status === 404) {
      if (!input.createIfMissing) return 'noop';
      if (!input.email) {
        throw new AudienceProviderError('MISSING_EMAIL');
      }
      const postRes = await fetch(`${BASE}/contacts`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          email: input.email,
          ext_id: input.extId,
          attributes: input.attributes,
          listIds: input.addListIds,
          updateEnabled: true,
        }),
      });
      if (postRes.ok) {
        // POST cannot unlink. Apply removals (resigned, later prospects) once the EXT_ID exists.
        if (input.removeListIds.length > 0) {
          const unlinkRes = await this.putContact(input.extId, {
            unlinkListIds: input.removeListIds,
          });
          if (!unlinkRes.ok) throw await this.fail(unlinkRes);
        }
        return 'created';
      }
      const postError = await this.readError(postRes);
      if (postError.code === 'DUPLICATE_EMAIL') {
        const retry = await this.putContact(input.extId, putBody);
        if (retry.ok) return 'updated';
        if (retry.status !== 404) {
          const retryError = await this.readError(retry);
          if (retryError.code !== 'DUPLICATE_EMAIL') throw this.warn(retry.status, retryError);
          if (await this.resolveDuplicateEmail(input)) return 'updated';
          throw this.warn(retry.status, retryError);
        }
        if (await this.resolveDuplicateEmail(input)) return 'updated';
      }
      throw this.warn(postRes.status, postError);
    }

    const putError = await this.readError(putRes);
    if (putError.code === 'DUPLICATE_EMAIL' && (await this.resolveDuplicateEmail(input))) {
      return 'updated';
    }
    throw this.warn(putRes.status, putError);
  }

  /**
   * The email already belongs to another contact.
   *
   * Only EXT_IDs in `claimFromExtIds` (the same email group) may be touched.
   * If the primary contact does not exist, that contact's EXT_ID is reassigned
   * to the primary. If the primary already exists under an old address, the
   * secondary contact is parked on that old address and its EXT_ID is cleared
   * so the primary can take the new address. Clearing EXT_ID leaves an orphan
   * contact; this sync does not look those up or delete them.
   * Anything else stays DUPLICATE_EMAIL.
   */
  private async resolveDuplicateEmail(input: UpsertContactInput): Promise<boolean> {
    const wanted = normalizeEmail(input.email);
    if (!wanted) return false;

    const holder = await this.findEmailHolder(input, wanted);
    if (!holder) return false;

    const primary = await this.readContact(input.extId);
    if (!primary) {
      const res = await this.putContact(holder, {
        ext_id: input.extId,
        attributes: input.attributes,
        listIds: input.addListIds,
        unlinkListIds: input.removeListIds,
      });
      if (res.ok) return true;
      throw await this.fail(res);
    }

    const oldEmail = primary.email?.trim();
    if (!oldEmail || normalizeEmail(oldEmail) === wanted) return false;

    const unlinkIds = [...new Set([...input.addListIds, ...input.removeListIds])];
    const park = await this.putContact(holder, {
      email: oldEmail,
      ext_id: '',
      listIds: [],
      unlinkListIds: unlinkIds,
    });
    if (!park.ok) throw await this.fail(park);

    const moved = await this.putContact(input.extId, this.contactBody(input));
    if (moved.ok) return true;
    throw await this.fail(moved);
  }

  private async findEmailHolder(input: UpsertContactInput, wanted: string): Promise<string | null> {
    for (const fromExtId of input.claimFromExtIds ?? []) {
      if (fromExtId === input.extId) continue;
      const existing = await this.readContact(fromExtId);
      if (existing && normalizeEmail(existing.email) === wanted) return fromExtId;
    }
    return null;
  }

  private contactBody(input: UpsertContactInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
      attributes: input.attributes,
      listIds: input.addListIds,
      unlinkListIds: input.removeListIds,
    };
    if (input.email) body.email = input.email;
    return body;
  }

  private putContact(extId: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${BASE}/contacts/${encodeURIComponent(extId)}?identifierType=ext_id`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
  }

  private async readContact(extId: string): Promise<{ email: string | null } | undefined> {
    const res = await fetch(`${BASE}/contacts/${encodeURIComponent(extId)}?identifierType=ext_id`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw await this.fail(res);
    const json = (await res.json()) as { email?: string | null };
    return { email: json.email ?? null };
  }

  private async readError(res: Response): Promise<AudienceProviderError> {
    return mapBrevoHttpError(res.status, await res.text());
  }

  private warn(status: number, error: AudienceProviderError): AudienceProviderError {
    this.logger.warn(`Brevo contact call failed status=${status} code=${error.code}`);
    return error;
  }

  private async fail(res: Response): Promise<AudienceProviderError> {
    const error = await this.readError(res);
    return this.warn(res.status, error);
  }
}
