import { IsString, MinLength, MaxLength, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKeyScope } from '@opencoop/database';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Claude Code - laptop' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ enum: ApiKeyScope, default: ApiKeyScope.READ_ONLY })
  @IsOptional()
  @IsEnum(ApiKeyScope)
  scope?: ApiKeyScope;
}
