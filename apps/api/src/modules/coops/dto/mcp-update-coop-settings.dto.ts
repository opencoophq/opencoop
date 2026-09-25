import { PickType } from '@nestjs/swagger';
import { UpdateCoopDto } from './update-coop.dto';

export class UpdateCoopSettingsDto extends PickType(UpdateCoopDto, [
  'name',
  'requiresApproval',
  'minimumHoldingPeriod',
  'legalForm',
  'foundedDate',
  'certificateSignatory',
  'coopPhone',
  'coopWebsite',
  'vatNumber',
  'coopAddress',
] as const) {}
