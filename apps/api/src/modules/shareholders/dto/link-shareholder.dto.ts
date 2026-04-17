import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkShareholderDto {
  @ApiProperty({
    description: 'ID of the target Shareholder to link to (the household anchor). If the target has no User yet, the backend will auto-create one.',
    example: 'clx...abc',
  })
  @IsString()
  @IsNotEmpty()
  targetShareholderId!: string;
}
