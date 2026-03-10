import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class EcoPowerUpdateItem {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsBoolean()
  isEcoPowerClient: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  ecoPowerId?: string;
}

export class UpdateEcoPowerDto {
  @ApiProperty({ type: [EcoPowerUpdateItem] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EcoPowerUpdateItem)
  updates: EcoPowerUpdateItem[];
}
