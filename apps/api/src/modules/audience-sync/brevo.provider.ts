import { Logger } from '@nestjs/common';
import {
  BrevoList,
  EmailAudienceProvider,
  UpsertContactInput,
  UpsertResult,
} from './audience-provider.interface';

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
    const putBody: Record<string, unknown> = {
      attributes: input.attributes,
      listIds: input.addListIds,
      unlinkListIds: input.removeListIds,
    };
    if (input.email) putBody.email = input.email;
    // NOTE: never set emailBlacklisted — preserve Brevo's unsubscribe state.

    const putRes = await fetch(
      `${BASE}/contacts/${encodeURIComponent(input.extId)}?identifierType=ext_id`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify(putBody) },
    );
    if (putRes.ok) return 'updated';

    if (putRes.status === 404) {
      if (!input.createIfMissing) return 'noop';
      if (!input.email) {
        throw new Error(`Cannot create Brevo contact ext_id=${input.extId}: no email`);
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
      throw new Error(
        `Brevo create failed ext_id=${input.extId}: ${postRes.status} ${await postRes.text()}`,
      );
    }

    throw new Error(
      `Brevo upsert failed ext_id=${input.extId}: ${putRes.status} ${await putRes.text()}`,
    );
  }
}
