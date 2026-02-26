import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({ enum: ['ESSENTIALS', 'PROFESSIONAL'] })
  @IsIn(['ESSENTIALS', 'PROFESSIONAL'])
  plan: 'ESSENTIALS' | 'PROFESSIONAL';

  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'] })
  @IsIn(['MONTHLY', 'YEARLY'])
  billingPeriod: 'MONTHLY' | 'YEARLY';
}
