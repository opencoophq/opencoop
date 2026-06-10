import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class KioskCheckInDto {
  @ApiProperty({ description: 'Shareholder being checked in' })
  @IsString()
  @IsNotEmpty()
  shareholderId: string;

  @ApiProperty({ description: 'Signature captured at the kiosk as a PNG data URL' })
  @IsString()
  @IsNotEmpty()
  signaturePngDataUrl: string;
}
