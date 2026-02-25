import { IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSaleDto {
  @ApiProperty({ description: 'Share to sell' })
  @IsString()
  shareId: string;

  @ApiProperty({ description: 'Number of shares to sell', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
