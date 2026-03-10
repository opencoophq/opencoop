import { IsString, IsBoolean, IsOptional, IsIn, IsInt, Min, MaxLength, IsNumber, IsEnum, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EcoPowerThresholdType } from '@opencoop/database';

export class UpdateCoopDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bankIban?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bankBic?: string;

  @ApiProperty({ required: false, description: 'Minimum holding period in months (0 = no restriction)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumHoldingPeriod?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  pontoEnabled?: boolean;

  @ApiProperty({ required: false, description: 'Email provider: null (platform), "smtp", or "graph"' })
  @IsOptional()
  @IsIn([null, 'smtp', 'graph'])
  emailProvider?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  smtpHost?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  smtpPort?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  smtpUser?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  smtpPass?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  smtpFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  graphClientId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  graphClientSecret?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  graphTenantId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  graphFromEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  ecoPowerEnabled?: boolean;

  @ApiProperty({ required: false, enum: EcoPowerThresholdType })
  @IsOptional()
  @IsEnum(EcoPowerThresholdType)
  ecoPowerMinThresholdType?: EcoPowerThresholdType | null;

  @ApiProperty({ required: false, description: 'Minimum threshold value (euro amount or share count)' })
  @IsOptional()
  @ValidateIf((o) => o.ecoPowerMinThreshold !== null)
  @IsNumber()
  ecoPowerMinThreshold?: number | null;
}
