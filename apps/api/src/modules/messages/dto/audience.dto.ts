import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AudienceDto {
  @ApiProperty({ enum: ['ALL', 'PROJECT', 'SELECTED'], example: 'PROJECT' })
  @IsIn(['ALL', 'PROJECT', 'SELECTED'])
  type: 'ALL' | 'PROJECT' | 'SELECTED';

  @ApiProperty({ required: false, description: 'Required when type is PROJECT' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Used when type is SELECTED', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareholderIds?: string[];
}
