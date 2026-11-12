import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAdminUserDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string | null;

  @ApiProperty({ required: false, enum: ['nl', 'en', 'fr', 'de'] })
  @IsOptional()
  @IsIn(['nl', 'en', 'fr', 'de'])
  preferredLanguage?: string;

  @ApiProperty({
    required: false,
    description:
      'Login email. Only a system admin may change it. A coop admin may resend the current value; any other value is rejected with 403.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
