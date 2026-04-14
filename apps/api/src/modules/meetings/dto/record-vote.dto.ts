import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VoteChoice } from '@opencoop/database';

export class RecordVoteDto {
  @ApiProperty()
  @IsString()
  shareholderId!: string;

  @ApiProperty({ enum: VoteChoice })
  @IsEnum(VoteChoice)
  choice!: VoteChoice;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  castViaProxyId?: string;
}

export class BulkRecordVotesDto {
  @ApiProperty({ type: [RecordVoteDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordVoteDto)
  votes!: RecordVoteDto[];
}
