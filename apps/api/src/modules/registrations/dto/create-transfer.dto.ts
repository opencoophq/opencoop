import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty({ description: 'Shareholder transferring the shares' })
  @IsString()
  fromShareholderId: string;

  @ApiProperty({ description: 'Shareholder receiving the shares' })
  @IsString()
  toShareholderId: string;

  @ApiProperty({ description: 'Buy registration from which to transfer shares' })
  @IsString()
  registrationId: string;

  @ApiProperty({ description: 'Number of shares to transfer', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
