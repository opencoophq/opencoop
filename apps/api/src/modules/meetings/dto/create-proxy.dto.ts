import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateProxyDto {
  @ApiProperty()
  @IsString()
  grantorShareholderId!: string;

  @ApiProperty()
  @IsString()
  delegateShareholderId!: string;
}
