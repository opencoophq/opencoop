import { OmitType } from '@nestjs/swagger';
import { UpdateCoopDto } from './update-coop.dto';

export class UpdateCoopSettingsDto extends OmitType(UpdateCoopDto, [
  'emailProvider',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpFrom',
  'graphClientId',
  'graphTenantId',
  'graphFromEmail',
  'brevoApiKey',
  'graphClientSecret',
  'emailEnabled',
  'pontoEnabled',
  'smtpPass',
] as const) {}
