import { OmitType } from '@nestjs/swagger';
import { UpdateCoopDto } from './update-coop.dto';

export class UpdateCoopSettingsDto extends OmitType(UpdateCoopDto, [
  'brevoApiKey',
  'graphClientSecret',
  'emailEnabled',
  'pontoEnabled',
  'smtpPass',
] as const) {}
