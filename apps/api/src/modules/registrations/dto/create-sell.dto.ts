import { IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSellDto {
  @ApiProperty({ description: 'Buy registration to sell shares from' })
  @IsString()
  registrationId: string;

  @ApiProperty({ description: 'Number of shares to sell', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
