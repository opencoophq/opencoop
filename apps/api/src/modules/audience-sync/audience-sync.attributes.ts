import { ContactAttributeValue } from './audience-provider.interface';

/**
 * Attributes written on the one contact for a resolved email.
 *
 * ACTIVE → COOPERANT=true, STATUS='active'.
 * INACTIVE (resigned) → COOPERANT=false, STATUS='resigned'.
 * PENDING never held shares: COOPERANT=false, and STATUS is left unset so they
 * are not labelled resigned.
 *
 * FIRSTNAME / LASTNAME are omitted when OpenCoop has no value, rather than
 * sending null.
 */
export function memberContactAttributes(shareholder: {
  status: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}): Record<string, ContactAttributeValue> {
  const attributes: Record<string, ContactAttributeValue> = {};
  if (shareholder.firstName) attributes.FIRSTNAME = shareholder.firstName;
  const lastName = shareholder.lastName ?? shareholder.companyName;
  if (lastName) attributes.LASTNAME = lastName;

  if (shareholder.status === 'ACTIVE') {
    attributes.COOPERANT = true;
    attributes.STATUS = 'active';
  } else if (shareholder.status === 'INACTIVE') {
    attributes.COOPERANT = false;
    attributes.STATUS = 'resigned';
  } else {
    attributes.COOPERANT = false;
  }
  return attributes;
}

export interface BrevoAttributeDefinition {
  name?: string;
  type?: string;
}

const REQUIRED_ATTRIBUTES = [
  { name: 'COOPERANT', type: 'boolean' },
  { name: 'STATUS', type: 'text' },
] as const;

/**
 * Human-readable gap for the test-connection endpoint.
 * Null when both attributes exist with the expected type.
 * Does not create anything in Brevo.
 */
export function describeMissingBrevoAttributes(
  attributes: readonly BrevoAttributeDefinition[],
): string | null {
  const byName = new Map<string, string>();
  for (const attribute of attributes) {
    if (!attribute.name) continue;
    byName.set(attribute.name.toUpperCase(), (attribute.type ?? '').toLowerCase());
  }
  const problems: string[] = [];
  for (const required of REQUIRED_ATTRIBUTES) {
    const found = byName.get(required.name);
    if (!found) {
      problems.push(`${required.name} (${required.type}) is not defined in this Brevo account`);
    } else if (found !== required.type) {
      problems.push(`${required.name} must be ${required.type}, found ${found}`);
    }
  }
  if (problems.length === 0) return null;
  return `MISSING_ATTRIBUTES: ${problems.join('; ')}`;
}

export interface MemberAttributeSupport {
  cooperant: boolean;
  status: boolean;
  /** Set when COOPERANT or STATUS cannot be sent. This does not fail the run. */
  warning: string | null;
}

/** Which of COOPERANT / STATUS may be written. A wrong type counts as absent. */
export function memberAttributeSupport(
  attributes: readonly BrevoAttributeDefinition[],
): MemberAttributeSupport {
  const byName = new Map<string, string>();
  for (const attribute of attributes) {
    if (!attribute.name) continue;
    byName.set(attribute.name.toUpperCase(), (attribute.type ?? '').toLowerCase());
  }
  return {
    cooperant: byName.get('COOPERANT') === 'boolean',
    status: byName.get('STATUS') === 'text',
    warning: describeMissingBrevoAttributes(attributes),
  };
}

/** Drop COOPERANT / STATUS when this Brevo account does not define them. */
export function filterMemberAttributes(
  attributes: Record<string, ContactAttributeValue>,
  support: MemberAttributeSupport,
): Record<string, ContactAttributeValue> {
  const next = { ...attributes };
  if (!support.cooperant) delete next.COOPERANT;
  if (!support.status) delete next.STATUS;
  return next;
}
