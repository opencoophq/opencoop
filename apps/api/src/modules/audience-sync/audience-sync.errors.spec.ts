import {
  AudienceProviderError,
  mapBrevoHttpError,
  maskEmail,
  maskEmailsInText,
  toSyncErrorDetail,
} from './audience-sync.errors';

describe('mapBrevoHttpError', () => {
  it('maps duplicate_parameter to DUPLICATE_EMAIL and drops the raw body', () => {
    const err = mapBrevoHttpError(
      400,
      JSON.stringify({
        code: 'duplicate_parameter',
        message:
          'Unable to update contact, email dup@b.c is already associated with another Contact',
      }),
    );
    expect(err).toBeInstanceOf(AudienceProviderError);
    expect(err.code).toBe('DUPLICATE_EMAIL');
    expect(err.message).toBe('DUPLICATE_EMAIL');
    expect(err.message).not.toContain('dup@b.c');
    expect(err.message).not.toContain('already associated');
  });

  it('maps other known Brevo codes and falls back without echoing the body', () => {
    expect(
      mapBrevoHttpError(400, JSON.stringify({ code: 'invalid_parameter', message: 'bad a@b.c' }))
        .code,
    ).toBe('INVALID_PARAMETER');
    const unknown = mapBrevoHttpError(
      400,
      JSON.stringify({
        code: 'invalid_parameter',
        message: 'Attribute COOPERANT does not exist for hidden@x.be',
      }),
    );
    expect(unknown.code).toBe('UNKNOWN_ATTRIBUTE');
    expect(unknown.message).toBe('UNKNOWN_ATTRIBUTE');
    expect(unknown.message).not.toContain('hidden@x.be');
    expect(
      mapBrevoHttpError(
        400,
        JSON.stringify({
          code: 'invalid_parameter',
          message: 'Contact attribute STATUS is not defined',
        }),
      ).code,
    ).toBe('UNKNOWN_ATTRIBUTE');
    expect(
      mapBrevoHttpError(
        400,
        JSON.stringify({
          code: 'invalid_parameter',
          message: 'Invalid contact attribute value',
        }),
      ).code,
    ).toBe('INVALID_PARAMETER');
    expect(
      mapBrevoHttpError(401, JSON.stringify({ code: 'unauthorized', message: 'unrecognised IP' }))
        .code,
    ).toBe('UNAUTHORIZED');
    expect(mapBrevoHttpError(429, 'slow down a@b.c')).toBeInstanceOf(AudienceProviderError);
    expect(mapBrevoHttpError(429, 'slow down a@b.c').code).toBe('RATE_LIMITED');
    expect(mapBrevoHttpError(400, 'not-json email hidden@x.be').code).toBe('BREVO_BAD_REQUEST');
    expect(mapBrevoHttpError(400, 'not-json email hidden@x.be').message).not.toContain(
      'hidden@x.be',
    );
    expect(mapBrevoHttpError(500, JSON.stringify({ message: 'boom hidden@x.be' })).code).toBe(
      'BREVO_ERROR',
    );
  });
});

describe('email masking', () => {
  it('masks a stored address and any address inside free text', () => {
    expect(maskEmail('Jan@Bronsgroen.be')).toBe('j***@b***.be');
    expect(maskEmail('Ann@Example.be')).toBe('a***@e***.be');
    expect(maskEmail('ann@x.be')).toBe('a***@x***.be');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmailsInText('failed for ann@example.be and bob@x.be')).toBe(
      'failed for a***@e***.be and b***@x***.be',
    );
  });

  it('stores the internal code and a masked email on the run detail', () => {
    const detail = toSyncErrorDetail(
      new AudienceProviderError('DUPLICATE_EMAIL'),
      'sh1',
      'ann@example.be',
    );
    expect(detail).toEqual({
      shareholderId: 'sh1',
      email: 'a***@e***.be',
      code: 'DUPLICATE_EMAIL',
      message: 'DUPLICATE_EMAIL',
    });
  });

  it('stores GROUP_EMAIL_CONFLICT with a masked address and no raw email', () => {
    const detail = toSyncErrorDetail(
      new AudienceProviderError('GROUP_EMAIL_CONFLICT'),
      'primary',
      'new@x.be',
    );
    expect(detail).toEqual({
      shareholderId: 'primary',
      email: 'n***@x***.be',
      code: 'GROUP_EMAIL_CONFLICT',
      message: 'GROUP_EMAIL_CONFLICT',
    });
    expect(JSON.stringify(detail)).not.toContain('new@x.be');
  });
});
