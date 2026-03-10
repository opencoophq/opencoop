import { IsArray, IsEmail, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class ShareholderQueryItem {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class QueryShareholdersDto {
  @ApiProperty({ type: [ShareholderQueryItem] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ShareholderQueryItem)
  shareholders: ShareholderQueryItem[];
}
