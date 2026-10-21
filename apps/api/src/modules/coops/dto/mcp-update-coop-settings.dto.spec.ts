import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCoopSettingsDto } from './mcp-update-coop-settings.dto';

describe('UpdateCoopSettingsDto', () => {
  it('accepts every allow-listed setting', async () => {
    const dto = plainToInstance(UpdateCoopSettingsDto, {
      name: 'Updated Coop',
      requiresApproval: true,
      minimumHoldingPeriod: 12,
      legalForm: 'CV',
      foundedDate: '2020-01-01',
      certificateSignatory: 'Ada Lovelace',
      coopPhone: '+3212345678',
      coopWebsite: 'https://coop.example',
      vatNumber: 'BE0123456789',
      coopAddress: { street: 'Main Street', city: 'Brussels' },
      volunteerInterests: ['flyers', 'stands', 'workshops', 'technical', 'admin', 'board'],
    });

    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual(
      [],
    );
  });

  it('rejects interest tags that the sanitiser would drop', async () => {
    const apostrophe = plainToInstance(UpdateCoopSettingsDto, {
      volunteerInterests: ["Conseil d'administration"],
    });
    const duplicate = plainToInstance(UpdateCoopSettingsDto, {
      volunteerInterests: ['board', 'Board'],
    });

    const apostropheErrors = await validate(apostrophe, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const duplicateErrors = await validate(duplicate, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(apostropheErrors.map((error) => error.property)).toContain('volunteerInterests');
    expect(duplicateErrors.map((error) => error.property)).toContain('volunteerInterests');
  });

  it.each([
    ['bankName', 'Bank'],
    ['bankIban', 'BE123'],
    ['bankBic', 'BIC123'],
    ['coopEmail', 'reply-to@example.com'],
    ['emailAudienceProvider', 'brevo'],
    ['brevoMembersListId', 'members-list'],
    ['brevoResignedListId', 'resigned-list'],
    ['ecoPowerEnabled', true],
    ['ecoPowerMinThresholdType', 'EURO'],
    ['ecoPowerMinThreshold', 100],
    ['emailProvider', 'smtp'],
    ['emailEnabled', true],
    ['pontoEnabled', true],
    ['smtpHost', 'smtp.example.com'],
    ['smtpPort', 587],
    ['smtpUser', 'attacker'],
    ['smtpPass', 'secret'],
    ['smtpFrom', 'attacker@example.com'],
    ['graphClientId', 'attacker'],
    ['graphClientSecret', 'secret'],
    ['graphTenantId', 'attacker'],
    ['graphFromEmail', 'attacker@example.com'],
    ['brevoApiKey', 'secret'],
  ])('rejects excluded field %s as a non-whitelisted property', async (field, value) => {
    const dto = plainToInstance(UpdateCoopSettingsDto, { [field]: value });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: field,
          constraints: expect.objectContaining({ whitelistValidation: expect.any(String) }),
        }),
      ]),
    );
  });
});
