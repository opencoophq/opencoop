import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsDateString, IsOptional, IsInt, Min, IsArray } from 'class-validator';
import { MeetingType, MeetingFormat, VotingWeight } from '@opencoop/database';

export class CreateMeetingDto {
  @ApiProperty({ enum: MeetingType })
  @IsEnum(MeetingType)
  type!: MeetingType;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsDateString()
  scheduledAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(15)
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({ enum: MeetingFormat })
  @IsEnum(MeetingFormat)
  format!: MeetingFormat;

  @ApiPropertyOptional({ enum: VotingWeight })
  @IsOptional()
  @IsEnum(VotingWeight)
  votingWeight?: VotingWeight;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxProxiesPerPerson?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  reminderDaysBefore?: number[];

  @ApiPropertyOptional({ description: 'Override the default convocation email subject. Leave null to use the system template.' })
  @IsOptional()
  @IsString()
  customSubject?: string | null;

  @ApiPropertyOptional({ description: 'HTML body that replaces the default convocation intro. Supports {{rsvpUrl}}, {{shareholderName}}, {{meetingTitle}}, {{meetingDate}}, {{meetingLocation}}, {{agendaList}} placeholders.' })
  @IsOptional()
  @IsString()
  customBody?: string | null;
}
