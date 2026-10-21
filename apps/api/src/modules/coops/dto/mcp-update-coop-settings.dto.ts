import { ApiProperty, PickType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { assertExactInterestTags } from '../../volunteers/volunteer-record';
import { UpdateCoopDto } from './update-coop.dto';

@ValidatorConstraint({ name: 'exactVolunteerInterests', async: false })
export class ExactVolunteerInterestsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return false;
    try {
      assertExactInterestTags(value);
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'volunteerInterests must be safe tags (letters, numbers, spaces, _, / or -), with no duplicates or apostrophes';
  }
}

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
] as const) {
  @ApiProperty({
    required: false,
    type: [String],
    description:
      'Ordered volunteer interest tags. Empty restores the built-in defaults. Tags the form translates are flyers, stands, workshops, technical, admin and board.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Validate(ExactVolunteerInterestsConstraint)
  volunteerInterests?: string[];
}
