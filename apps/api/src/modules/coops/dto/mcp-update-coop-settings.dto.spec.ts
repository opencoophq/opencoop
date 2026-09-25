import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCoopSettingsDto } from './mcp-update-coop-settings.dto';

describe('UpdateCoopSettingsDto', () => {
  it.each([
    ['emailProvider', 'smtp'],
    ['smtpHost', 'smtp.example.com'],
    ['smtpPort', 587],
    ['smtpUser', 'attacker'],
    ['smtpFrom', 'attacker@example.com'],
    ['graphClientId', 'attacker'],
    ['graphTenantId', 'attacker'],
    ['graphFromEmail', 'attacker@example.com'],
  ])('rejects transport field %s as a non-whitelisted property', async (field, value) => {
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
